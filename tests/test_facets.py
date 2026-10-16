# -*- coding: utf-8 -*-
"""The filter window's counts agree with the list they sit beside.

A number printed next to a book, an error type, a status or an origin must
be what the list shows once that entry is chosen, under every combination of
the other filters (the bug of PR #5: counts that ignored the filters showed
findings while the table was empty).

Run:  python -X utf8 -m unittest tests.test_facets -v
"""
import itertools
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from magiah.webui import db, server                             # noqa: E402

FCOLS = ('id, family, errtype, word, suggestion, rank, verified, origin, '
         'source, ref, unit, doc, snippet')

# (id, word, errtype, origin, doc, unit, rank, verified)
ROWS = [
    (1, 'בית', 'edit1_sub', 'o1', '1', '100', 9.0, 1),
    (2, 'בית', 'edit1_sub', 'o1', '1', '101', 4.0, 0),
    (3, 'שלם', 'missing_space', 'o1', 'a/b.txt', 'file:a/b.txt:3', 7.0, 1),
    (4, 'שלם', 'edit1_sub', 'o2', 'a/b.txt', 'file:a/b.txt:4', 2.0, 0),
    (5, 'דבר', 'missing_space', 'o2', 'לא רלוונטי/c.txt',
     'file:לא רלוונטי/c.txt:1', 8.0, 1),
    (6, 'דבר', 'edit1_sub', 'o2', 'd.txt', 'file:d.txt:9', 6.5, 0),
    (7, 'ספר', 'missing_space', 'o1', '2', '200', 3.0, 1),
    (8, 'ספר', 'edit1_sub', 'o1', 'd.txt', 'file:d.txt:2', 10.0, 1),
]
DECIDED = {'approved': [1, 4], 'not_error': [3, 6], 'unsure': [8]}

FILTER_AXES = {
    'origin': ['', 'o1'],
    'errtype': ['', 'edit1_sub', 'edit1_sub,missing_space'],
    'status': ['', 'pending', 'approved,not_error'],
    'verified': ['', '1'],
    'min_rank': ['', '5'],
    'q': ['', 'בית'],
    'hide_irr': ['', '1'],
    'hide_db': ['', '1'],
}


class FacetCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='magiah_facets_')
        self.outdir = os.path.join(self.tmp, 'scan')
        os.makedirs(self.outdir)
        self.con = db.connect(self.outdir)
        for fid, word, et, origin, doc, unit, rank, ver in ROWS:
            self.con.execute(
                f'INSERT INTO findings({FCOLS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (fid, 'error', et, word, word + 'ו', rank, ver, origin,
                 'ספר ' + doc, 'r', unit, doc, 'x ' + word + ' y'))
        self.con.commit()
        for status, ids in DECIDED.items():
            db.set_status(self.con, self.outdir, ids, status)

    def tearDown(self):
        self.con.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def combos(self):
        keys = list(FILTER_AXES)
        for vals in itertools.product(*(FILTER_AXES[k] for k in keys)):
            yield {k: v for k, v in zip(keys, vals) if v}

    def listing(self, filters):
        rows, total = db.query_findings(self.con, filters, page_size=500)
        return rows, total


class TestCountsMatchList(FacetCase):
    def test_total_is_the_lists_total(self):
        for f in self.combos():
            self.assertEqual(db.get_facets(self.con, f)['total'],
                             self.listing(f)[1], f)

    def test_each_group_entry_is_what_choosing_it_shows(self):
        for f in self.combos():
            fac = db.get_facets(self.con, f)
            for o in fac['origins']:
                rows, total = self.listing({**f, 'origin': o['name']})
                self.assertEqual(o['count'], total, (f, o))
                self.assertEqual(
                    o['pending_count'],
                    sum(r['effective_status'] == 'pending' for r in rows),
                    (f, o))
            for e in fac['errtypes']:
                rows, total = self.listing({**f, 'errtype': e['key']})
                self.assertEqual(e['count'], total, (f, e))
                self.assertEqual(
                    e['pending_count'],
                    sum(r['effective_status'] == 'pending' for r in rows),
                    (f, e))
            for s in fac['statuses']:
                self.assertEqual(
                    s['count'], self.listing({**f, 'status': s['key']})[1],
                    (f, s))

    def test_each_book_is_what_choosing_it_shows(self):
        for f in self.combos():
            books = db.get_books(self.con, filters=f)
            for b in books:
                rows, total = self.listing({**f, 'book_key': b['key']})
                self.assertEqual(b['count'], total, (f, b))
                self.assertEqual(
                    b['pending_count'],
                    sum(r['effective_status'] == 'pending' for r in rows),
                    (f, b))

    def test_books_with_no_findings_under_the_filters_are_left_out(self):
        books = db.get_books(self.con, filters={'errtype': 'missing_space',
                                                'verified': '1'})
        self.assertEqual(sorted(b['key'] for b in books),
                         ['2', 'a/b.txt', 'לא רלוונטי/c.txt'])

    def test_a_chosen_book_does_not_hide_the_others(self):
        # the book group is counted without its own selection
        books = db.get_books(self.con, filters={'book_key': '1'})
        self.assertEqual(len(books), len({r[4] for r in ROWS}))

    def test_nothing_matches_gives_zeroes_not_stale_counts(self):
        f = {'errtype': 'missing_space', 'min_rank': '9.5'}
        fac = db.get_facets(self.con, f)
        self.assertEqual(fac['total'], 0)
        self.assertEqual(db.get_books(self.con, filters=f), [])

    def test_title_search_and_origin_still_work(self):
        books = db.get_books(self.con, 'o1', 'a/b')
        self.assertEqual([b['key'] for b in books], ['a/b.txt'])
        self.assertEqual(books[0]['count'], 1)


class TestHttp(FacetCase):
    def setUp(self):
        super().setUp()
        server.Handler.outdir = self.outdir
        self.srv = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        super().tearDown()

    def get(self, path, **params):
        url = 'http://127.0.0.1:%d%s?%s' % (
            self.port, path, urllib.parse.urlencode(params))
        with urllib.request.urlopen(url) as r:
            return json.loads(r.read().decode('utf-8'))

    def test_facets_endpoint_reads_the_findings_parameters(self):
        params = dict(origin='o1', errtype='edit1_sub', verified='1',
                      hide_irr='1')
        fac = self.get('/api/facets', **params)
        lst = self.get('/api/findings', **params)
        self.assertEqual(fac['total'], lst['total'])
        self.assertEqual({o['name'] for o in fac['origins']}, {'o1'})

    def test_books_endpoint_takes_the_filters_and_keeps_q_for_titles(self):
        # `q` is the title search, `search` the list's free-text search
        by_title = self.get('/api/books', q='a/b')
        self.assertEqual([b['key'] for b in by_title['books']], ['a/b.txt'])
        by_word = self.get('/api/books', search='בית')
        self.assertEqual([b['key'] for b in by_word['books']], ['1'])
        self.assertEqual(by_word['books'][0]['count'], 2)
        narrowed = self.get('/api/books', errtype='missing_space',
                            status='pending', verified='1')
        lst = self.get('/api/findings', errtype='missing_space',
                       status='pending', verified='1', page_size=500)
        want = {}
        for r in lst['rows']:
            want[r['doc']] = want.get(r['doc'], 0) + 1
        self.assertEqual({b['key']: b['count'] for b in narrowed['books']},
                         want)


if __name__ == '__main__':
    unittest.main()

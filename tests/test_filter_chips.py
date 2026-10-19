# -*- coding: utf-8 -*-
"""The filter window's chips and counts logic (findings.js), run through node.

The number on the "סינון · N" button is the number of chips; each chip undoes
exactly its own filter; "clear filters" never touches the hide switches; and
the query the counts are asked with is the list's own, so the answer is only
used while it still describes the current filters.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from appsrc import write_app_js                                  # noqa: E402

NODE = shutil.which('node')
HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, 'js', 'filter_chips_harness.js')
META = {
    'origins': [{'name': 'Sefaria', 'hebrew': 'ספריא'}],
    'errtypes': [{'key': 'edit1_sub', 'hebrew': 'החלפת אות'},
                 {'key': 'missing_space', 'hebrew': 'רווח חסר'}],
    'statuses': [{'key': 'pending', 'hebrew': 'טרם נבדק', 'icon': ''},
                 {'key': 'approved', 'hebrew': 'אושר', 'icon': ''}],
}
ALL = {'origin': 'Sefaria', 'book': 'a/b.txt',
       'errtypes': ['edit1_sub', 'missing_space'], 'statuses': ['approved'],
       'verified': True, 'min_rank': 6, 'q': 'בית'}


@unittest.skipIf(NODE is None, 'node is not installed')
class FilterChipsTest(unittest.TestCase):

    def run_cases(self, *cases):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'cases.json')
            with open(p, 'w', encoding='utf-8') as f:
                json.dump({'cases': [dict(c, state=dict(
                    c.get('state', {}), meta=META)) for c in cases]}, f,
                    ensure_ascii=False)
            out = subprocess.run([NODE, HARNESS, write_app_js(d), p],
                                 capture_output=True, timeout=60)
        self.assertEqual(out.returncode, 0,
                         out.stderr.decode('utf-8', 'replace'))
        return json.loads(out.stdout.decode('utf-8'))

    def test_no_filters_no_chips(self):
        (r,) = self.run_cases({'op': 'chips'})
        self.assertEqual(r, {'n': 0, 'chips': []})

    def test_every_filter_and_each_hide_switch_is_a_chip(self):
        (r,) = self.run_cases({
            'op': 'chips', 'bookNames': {'a/b.txt': 'ספר א'},
            'state': {'filters': ALL, 'hideIrr': True, 'hideDb': True}})
        self.assertEqual(r['n'], 10)
        self.assertEqual([c['kind'] for c in r['chips']],
                         ['filter'] * 8 + ['hide'] * 2)
        labels = [c['label'] for c in r['chips']]
        self.assertIn('ספר: ספר א', labels)        # the name, not the key
        self.assertIn('מאגר: ספריא', labels)
        self.assertIn('ציון מ־6', labels)

    def test_a_book_missing_from_the_list_keeps_a_readable_name(self):
        (r,) = self.run_cases({'op': 'chips', 'state': {
            'filters': {'book': 'line:77'}}})
        self.assertEqual(r['chips'][0]['label'], 'ספר: line:77')
        (r,) = self.run_cases({'op': 'chips',
                               'bookNames': {'line:77': 'בראשית רבה'},
                               'state': {'filters': {'book': 'line:77'}}})
        self.assertEqual(r['chips'][0]['label'], 'ספר: בראשית רבה')

    def test_a_chip_undoes_only_its_own_filter(self):
        n = 8
        cases = [{'op': 'clear', 'index': i, 'state': {'filters': ALL}}
                 for i in range(n)]
        res = self.run_cases(*cases)
        for i, r in enumerate(res):
            changed = [k for k in ALL if r['filters'][k] != ALL[k]]
            self.assertEqual(len(changed), 1, (i, changed))
        # the two error types are two chips, and removing one keeps the other
        self.assertEqual(res[3]['filters']['errtypes'], ['missing_space'])
        self.assertEqual(res[4]['filters']['errtypes'], ['edit1_sub'])

    def test_a_hide_chip_turns_its_switch_off_and_nothing_else(self):
        res = self.run_cases(
            {'op': 'clear', 'index': 0,
             'state': {'hideIrr': True, 'hideDb': True}},
            {'op': 'clear', 'index': 1,
             'state': {'hideIrr': True, 'hideDb': True}})
        self.assertEqual((res[0]['hideIrr'], res[0]['hideDb']), (False, True))
        self.assertEqual((res[1]['hideIrr'], res[1]['hideDb']), (True, False))

    def test_clear_filters_resets_every_filter_but_keeps_the_hide_switches(self):
        (r,) = self.run_cases({'op': 'clearAll', 'state': {
            'filters': dict(ALL, sort='word', dir='asc'),
            'hideIrr': True, 'hideDb': True}})
        self.assertEqual(r['filters'], {
            'origin': '', 'book': '', 'errtypes': [], 'statuses': [],
            'verified': False, 'min_rank': 0, 'q': '', 'sort': 'rank',
            'dir': 'desc'})
        self.assertEqual((r['hideIrr'], r['hideDb']), (True, True))

    def test_the_book_search_text_is_one_value_in_both_boxes(self):
        # typed in the filter window or in the books column, it shows in both
        a, b, c = self.run_cases(
            {'op': 'bookQuery', 'set': 'משנה', 'dialog': 'משנה'},
            {'op': 'bookQuery', 'set': 'משנה', 'column': 'משנה'},
            {'op': 'bookQuery', 'set': '', 'dialog': 'x', 'column': 'y'})
        for r in (a, b):
            self.assertEqual(r, {'q': 'משנה', 'dialog': 'משנה', 'column': 'משנה'})
        self.assertEqual(c, {'q': '', 'dialog': '', 'column': ''})

    def test_the_counts_query_is_the_lists_without_paging_and_sorting(self):
        (r,) = self.run_cases({'op': 'query', 'state': {
            'filters': dict(ALL, sort='word', dir='asc'), 'page': 3,
            'hideIrr': True}})
        q = parse_qs(r['query'])
        for k in ('sort', 'dir', 'page', 'page_size'):
            self.assertNotIn(k, q)
        self.assertEqual(q['origin'], ['Sefaria'])
        self.assertEqual(q['book_key'], ['a/b.txt'])
        self.assertEqual(q['errtype'], ['edit1_sub,missing_space'])
        self.assertEqual(q['status'], ['approved'])
        self.assertEqual(q['verified'], ['1'])
        self.assertEqual(q['min_rank'], ['6'])
        self.assertEqual(q['q'], ['בית'])
        self.assertEqual(q['hide_irr'], ['1'])
        self.assertNotIn('hide_db', q)

    def test_an_answer_for_other_filters_is_not_used(self):
        state = {'filters': {'origin': 'Sefaria'}}
        (probe,) = self.run_cases({'op': 'query', 'state': state})
        fresh, stale, none = self.run_cases(
            {'op': 'query', 'state': state, 'facets': {'total': 7},
             'facetsKey': probe['query']},
            {'op': 'query', 'state': state, 'facets': {'total': 7},
             'facetsKey': 'origin=Other'},
            {'op': 'query', 'state': state})
        self.assertEqual((fresh['fresh'], fresh['total']), (True, 7))
        self.assertEqual((stale['fresh'], stale['total']), (False, None))
        self.assertEqual((none['fresh'], none['total']), (False, None))


if __name__ == '__main__':
    unittest.main()

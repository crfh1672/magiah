# -*- coding: utf-8 -*-
"""The navigation rail and the status strip, checked on index.html itself.

Every station of the rail leads to a screen that exists, nothing the old top
bar and "more" menu offered was dropped, and the result-status strip sits
outside the scrolling workspace so it shows on every screen.

Run:  python -X utf8 -m unittest tests.test_nav_structure -v
"""
import os
import re
import unittest
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'magiah', 'webui', 'static', 'index.html')


class Tree(HTMLParser):
    VOID = {'meta', 'link', 'input', 'br', 'img', 'hr', 'use', 'path',
            'circle', 'rect', 'polygon'}

    def __init__(self):
        super().__init__()
        self.stack = []
        self.nodes = []          # (tag, attrs, ancestors-ids, text)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.nodes.append((tag, a, [x for x in self.stack if x]))
        if tag not in self.VOID:
            self.stack.append(a.get('id', ''))

    def handle_endtag(self, tag):
        if tag not in self.VOID and self.stack:
            self.stack.pop()


def parse():
    t = Tree()
    with open(INDEX, encoding='utf-8') as f:
        t.feed(f.read())
    return t.nodes


class TestNav(unittest.TestCase):
    def setUp(self):
        self.nodes = parse()
        self.ids = {a['id'] for _, a, _ in self.nodes if 'id' in a}

    def in_rail(self):
        return [(tag, a) for tag, a, anc in self.nodes
                if 'rail' in anc and tag == 'button']

    def test_rail_has_the_five_stations_in_order(self):
        stations = [a.get('data-goview') or a.get('data-station')
                    for _, a in self.in_rail()][:5]
        self.assertEqual(stations, ['review', 'fixer', 'stats', 'scan', 'help'])

    def test_every_station_leads_to_a_screen(self):
        for _, a in self.in_rail():
            v = a.get('data-goview')
            if v:
                self.assertIn('view-' + v, self.ids, v)
        for tag, a, anc in self.nodes:
            if 'viewtabs' in anc and a.get('data-view'):
                self.assertIn('view-' + a['data-view'], self.ids)
        self.assertEqual(
            {a['data-view'] for tag, a, anc in self.nodes
             if 'viewtabs' in anc and 'data-view' in a},
            {'table', 'cards'})

    def test_buttons_the_scripts_look_up_are_still_there(self):
        for i in ('btnScan', 'btnHelp', 'btnTheme', 'btnReview', 'btnUndo',
                  'btnSidebar', 'exportMenu', 'expXlsxCurrent', 'expXlsxAll',
                  'expFixes', 'globalSearch', 'progressPill', 'sessionCounter'):
            self.assertIn(i, self.ids, i)

    def test_the_more_menu_is_gone_and_nothing_was_in_it_alone(self):
        # scan, help and the theme moved to the rail
        self.assertNotIn('moreMenu', self.ids)
        in_topbar = {a.get('id') for _, a, anc in self.nodes if 'topbar' in anc}
        for i in ('btnScan', 'btnHelp', 'btnTheme'):
            self.assertNotIn(i, in_topbar)

    def test_icon_buttons_keep_an_accessible_name(self):
        for tag, a, anc in self.nodes:
            if a.get('id') in ('btnUndo', 'btnSidebar'):
                self.assertTrue(a.get('aria-label') or a.get('title'), a)
            if 'exportMenu' in anc and tag == 'summary':
                self.assertTrue(a.get('aria-label'))

    def test_status_strip_is_outside_the_scrolling_workspace(self):
        for tag, a, anc in self.nodes:
            if a.get('id') == 'resultBanner':
                self.assertNotIn('main', anc)
                self.assertNotIn('layout', anc)
                self.assertEqual(a.get('role'), 'status')
                return
        self.fail('no #resultBanner')

    def test_strip_comes_between_the_top_bar_and_the_layout(self):
        with open(INDEX, encoding='utf-8') as f:
            src = f.read()
        pos = [src.index(x) for x in
               ('<header id="topbar"', 'id="resultBanner"', '<div id="layout">')]
        self.assertEqual(pos, sorted(pos))

    def test_hash_keys_for_the_screens_are_unchanged(self):
        with open(os.path.join(os.path.dirname(INDEX), 'core.js'),
                  encoding='utf-8') as f:
            core = f.read()
        self.assertRegex(core, r'p\.set\("v",\s*S\.view\)')
        self.assertTrue(re.search(r'S\.view\s*=\s*p\.get\("v"\)\s*\|\|\s*"table"', core))


if __name__ == '__main__':
    unittest.main()

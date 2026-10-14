"""The web UI's JavaScript is a set of classic scripts (no build step); the
order they load in is the order of the <script> tags in index.html.  Tests
that read the UI's source see all of it, in that order."""
import os
import re

STATIC = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), 'magiah', 'webui', 'static')


def app_js_files():
    with open(os.path.join(STATIC, 'index.html'), encoding='utf-8') as f:
        html = f.read()
    names = re.findall(r'<script src="/static/([\w.-]+\.js)"></script>', html)
    return [os.path.join(STATIC, n) for n in names]


def app_source():
    parts = []
    for p in app_js_files():
        with open(p, encoding='utf-8') as f:
            parts.append(f.read())
    return '\n'.join(parts)


def write_app_js(directory):
    """All the scripts as one file in `directory`; returns its path."""
    path = os.path.join(directory, 'app_all.js')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(app_source())
    return path

#!/usr/bin/env python3
"""Check static public pages against their production URLs. No dependencies/network."""
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit, unquote

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'https://www.sidecaradvisory.com'
class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids=set(); self.links=[]; self.assets=[]; self.title=''; self.h1=0
        self.canonical=None; self.description=None; self.schemas=[]; self.in_schema=False
        self.in_title=False; self.buffer=''; self.feed(text)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if 'id' in a: self.ids.add(a['id'])
        if tag=='h1': self.h1+=1
        if tag=='title': self.in_title=True
        if tag=='a' and a.get('href'): self.links.append(a['href'])
        if tag in ['script','img','iframe'] and a.get('src'): self.assets.append(a['src'])
        if tag=='link':
            if a.get('rel')=='canonical': self.canonical=a.get('href')
            elif a.get('href'): self.assets.append(a['href'])
        if tag=='meta':
            if a.get('name')=='description': self.description=a.get('content')
            if a.get('property')=='og:image' or a.get('name')=='twitter:image': self.assets.append(a.get('content',''))
        if tag=='script' and a.get('type')=='application/ld+json': self.in_schema=True;self.buffer=''
    def handle_data(self, text):
        if self.in_title: self.title+=text
        if self.in_schema: self.buffer+=text
    def handle_endtag(self,tag):
        if tag=='title':self.in_title=False
        if tag=='script' and self.in_schema:
            self.schemas.append(json.loads(self.buffer));self.in_schema=False

config=json.loads((ROOT/'vercel.json').read_text())
rewrites={r['source']:r['destination'] for r in config['rewrites'] if r['destination'].endswith('.html')}
redirects={r['source']:r['destination'] for r in config['redirects']}
urls=[n.text for n in ET.parse(ROOT/'sitemap.xml').iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
errors=[];pages={};link_count=0;asset_count=0

def target(url):
    u=urlsplit(url);seen=set()
    while u.path in redirects:
        if u.path in seen:raise ValueError('redirect loop: '+url)
        seen.add(u.path);u=urlsplit(urljoin(ORIGIN,redirects[u.path])+('' if '#' in redirects[u.path] else ('#'+u.fragment if u.fragment else '')))
    p=rewrites.get(u.path,'/index.html' if u.path=='/' else u.path)
    return ROOT/unquote(p).lstrip('/'),u.fragment

def page(file):
    if file not in pages:pages[file]=Page(file.read_text())
    return pages[file]

for url in urls:
    try:
        file,_=target(url);p=page(file)
        if p.canonical!=url:errors.append(f'{url}: canonical mismatch {p.canonical}')
        if not p.title.strip() or not p.description:errors.append(f'{url}: missing title/description')
        if p.h1!=1:errors.append(f'{url}: expected one H1, found {p.h1}')
        for attr,items in [('link',p.links),('asset',p.assets)]:
            for item in items:
                u=urlsplit(urljoin(url,item))
                if u.scheme not in ['https','http'] or u.hostname not in ['www.sidecaradvisory.com','sidecaradvisory.com']:continue
                if u.path.startswith(('/internal','/portal','/api/','/t/','/r/')):continue
                if attr=='link':link_count+=1
                else:asset_count+=1
                dest,fragment=target(u.geturl())
                if not dest.is_file():errors.append(f'{url}: broken {attr} {item} -> {u.path}');continue
                if attr=='link' and fragment and dest.suffix=='.html' and fragment not in page(dest).ids:
                    errors.append(f'{url}: missing anchor {item}')
    except Exception as e:errors.append(f'{url}: {e}')
if len(set(page(target(url)[0]).title for url in urls))!=len(urls):errors.append('Duplicate sitemap page titles')
for err in sorted(set(errors)):print(err)
print(f'Checked {len(urls)} sitemap pages, {link_count} internal links, {asset_count} local asset references; {len(set(errors))} errors.')
sys.exit(1 if errors else 0)

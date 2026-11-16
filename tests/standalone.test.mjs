import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {Script} from 'node:vm';
import {createHash} from 'node:crypto';
const path=new URL('../dist/MARK-3D-Studio-standalone.html',import.meta.url);
test('Offline HTML bundles Three.js and does not need CDN',()=>{
 const html=readFileSync(path,'utf8');
 assert.ok(statSync(path).size>200000);
 assert.match(html,/__MARK_STUDIO_READY__/);
 assert.doesNotMatch(html,/https?:\/\/cdn\.jsdelivr\.net|<script[^>]+src=|<link[^>]+href=/i);
 assert.doesNotMatch(html,/type="importmap"|type="module"/);
 assert.match(html,/Открыть тестовую голову/);
 assert.match(html,/Ошибка запуска/);
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
 assert.equal(scripts.length,2,'Expected bootstrap and bundled editor scripts');
 for(const script of scripts) assert.doesNotThrow(()=>new Script(script), 'Bundled JavaScript must be syntactically executable');
});

test('Offline HTML and build-info.json identify exactly the same GitHub source commit',()=>{
 const html=readFileSync(path),manifest=JSON.parse(readFileSync(new URL('../dist/build-info.json',import.meta.url),'utf8'));
 const recorded=html.toString('utf8').match(/<meta name="mark-source-commit" content="([^"]+)">/);
 assert.ok(recorded,'Missing source SHA in standalone HTML');
 assert.equal(recorded[1],manifest.sourceCommit);
 assert.equal(manifest.htmlSha256,createHash('sha256').update(html).digest('hex'));
 const expected=process.env.GITHUB_SHA||'local-unverified';
 assert.equal(manifest.sourceCommit,expected,'GitHub source SHA does not match HTML provenance');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {Script} from 'node:vm';
const path=new URL('../dist/MARK-3D-Studio-standalone.html',import.meta.url);
test('Offline HTML bundles Three.js and does not need CDN',()=>{
 const html=readFileSync(path,'utf8');
 assert.ok(statSync(path).size>200000);
 assert.match(html,/__MARK_STUDIO_READY__/);
 assert.doesNotMatch(html,/https?:\/\/cdn\.jsdelivr\.net|<script[^>]+src=|<link[^>]+href=/i);
 assert.doesNotMatch(html,/type="importmap"|type="module"/);
 assert.match(html,/Открыть тестовую 3D-модель/);
 assert.match(html,/Ошибка запуска/);
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
 assert.equal(scripts.length,2,'Expected bootstrap and bundled editor scripts');
 for(const script of scripts) assert.doesNotThrow(()=>new Script(script), 'Bundled JavaScript must be syntactically executable');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadServerModule} from '../scripts/server-runtime.mjs';
const {pinCooldown,PinLockout}=await loadServerModule('app/kiosk/pin-lockout.tsx');
const {PinForm}=await loadServerModule('app/kiosk/pin-form.tsx');

test('tablet countdown honors server retry time and falls back safely for malformed responses',()=>{
 assert.deepEqual(pinCooldown('855','device',1000),{until:856000,scope:'device'});
 assert.deepEqual(pinCooldown('8.2','pin',1000),{until:10000,scope:'pin'});
 for(const value of [null,'nonsense','0','-1'])assert.deepEqual(pinCooldown(value,'unexpected',1000),{until:901000,scope:'device'});
 assert.equal(pinCooldown('999999','device',0).until,900000);
});
test('PIN-specific and device lockouts explain who can retry without exposing credentials',()=>{
 const pin=renderToStaticMarkup(createElement(PinLockout,{value:{until:Date.now()+900000,scope:'pin'},onExpired:()=>{}}));
 assert.match(pin,/Other employees can still enter their own PINs/);assert.match(pin,/role="timer" aria-live="off"/);assert.match(pin,/No clock action has been recorded/);
 const device=renderToStaticMarkup(createElement(PinLockout,{value:{until:Date.now()+900000,scope:'device'},manager:true,onExpired:()=>{}}));
 assert.match(device,/Manager approval on this tablet is temporarily locked/);assert.doesNotMatch(device,/different approval PIN/);assert.match(device,/Ask a manager for help/);
});
test('device lockout disables the input, keypad and submit while retaining accessible explanation',()=>{
 const html=renderToStaticMarkup(createElement(PinForm,{busy:false,locked:true,describedBy:'kiosk-lockout',onSubmit:async()=>{}}));
 assert.match(html,/aria-describedby="kiosk-pin-hint kiosk-lockout"/);assert.match(html,/<input[^>]*disabled/);
 const buttons=html.match(/<button[^>]*>/g);assert.equal(buttons.length,13);assert.ok(buttons.every(tag=>tag.includes('disabled')));assert.match(html,/Temporarily locked/);assert.doesNotMatch(html,/Please wait/);
});

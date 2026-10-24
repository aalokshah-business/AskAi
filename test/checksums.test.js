'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {checkoutBytes}=require('../scripts/sums');
test('checksums use checkout newlines without changing UTF-8 or input buffers',()=>{
  const source=Buffer.from('café\r\nnext\n'),original=Buffer.from(source);
  assert.equal(checkoutBytes(source,{text:'auto',eol:'lf'}).toString(),'café\nnext\n');
  assert.equal(checkoutBytes(source,{text:'set',eol:'crlf'}).toString(),'café\r\nnext\r\n');
  assert.deepEqual(source,original);
});
test('binary checksum payloads remain byte-for-byte unchanged',()=>{
  const data=Buffer.from([0,13,10,255,10]);
  assert.deepEqual(checkoutBytes(data,{text:'auto',eol:'lf'}),data);
  assert.deepEqual(checkoutBytes(Buffer.from('PDF\r\n'),{text:'unset',eol:'lf'}),Buffer.from('PDF\r\n'));
});

const {test}=require('node:test');const assert=require('node:assert/strict');const {providerUsage,combineUsage}=require('../usage.cjs');
test('Provider usage remains unknown if any count is missing; reported zero stays zero',()=>{
 const known=providerUsage({input_tokens:10,output_tokens:0},'model');assert.equal(known.completionTokens,0);assert.equal(providerUsage(null,'model').source,'unavailable');assert.equal(providerUsage({input_tokens:0},'model').source,'unavailable');assert.equal(combineUsage([known,providerUsage(null)],'model').source,'unavailable');assert.equal(combineUsage([known,known],'model').promptTokens,20);
});

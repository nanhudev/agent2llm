function providerUsage(usage, model) {
  if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0) return {source:'unavailable',reason:'Provider did not report both token counts.'};
  return {source:'provider-reported',promptTokens:usage.input_tokens,completionTokens:usage.output_tokens,model};
}
function combineUsage(values,model){if(!values.length||values.some(v=>v.source!=='provider-reported'))return {source:'unavailable',reason:'At least one execution step did not report usage.'};return {source:'provider-reported',promptTokens:values.reduce((s,v)=>s+v.promptTokens,0),completionTokens:values.reduce((s,v)=>s+v.completionTokens,0),model};}
module.exports={providerUsage,combineUsage};

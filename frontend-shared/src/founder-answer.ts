import type { Message } from './types';

function metric(text: string, label: string): string|null {
 const values = [...text.matchAll(new RegExp('\\b'+label+'\\b(?:\\s+(?:target|figure|is|was|of|for\\s+2026|should\\s+be|at))*\\s*[:=]?\\s*(\\$?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:k|m|million|thousand|months?)?)\\b','gi'))].map(match=>match[1].trim());
 return values.length===1 ? values[0] : null;
}

/** Only explicit numeric assertions from the founder's private replies count. */
export function initialFounderAnswer(messages: Message[], founderId: string): {text:string;messages:Message[]}|null {
 let revenue: {value:string;message:Message}|null = null;
 let reserve: {value:string;message:Message}|null = null;
 for (const message of messages) {
  if (message.author.kind!=='human' || message.author.id!==founderId || message.owner_id!==founderId || message.audience.kind!=='private_ai') continue;
  if (/\b(?:maybe|perhaps|unknown|unsure|not sure|do not know|don't know|if|would|could|might|assuming|suppose|hypothetical|projected|forecast|between|either|or|about|around|roughly|approximately)\b|\?|\d[\d,.]*(?:\s*(?:million|thousand|k|m))?\s*(?:[-–—/]|to)\s*\$?\d/i.test(message.text)) {
   if(/\brevenue\b/i.test(message.text))revenue=null;
   if(/\breserves?\b/i.test(message.text))reserve=null;
   continue;
  }
  const revenueValue=metric(message.text,'(?:annual\\s+)?revenue');
  const reserveValue=metric(message.text,'(?:cash\\s+)?reserve(?:s)?');
  if (revenueValue) revenue={value:revenueValue,message};
  if (reserveValue) reserve={value:reserveValue,message};
 }
 if (!revenue || !reserve) return null;
 const evidence=[revenue.message,reserve.message].filter((message,index,all)=>all.findIndex(item=>item.id===message.id)===index);
 return {text:`Founder-reported revenue: ${revenue.value}\nFounder-reported reserve target: ${reserve.value}\n\n${evidence.map(message=>message.text).join('\n')}`,messages:evidence};
}

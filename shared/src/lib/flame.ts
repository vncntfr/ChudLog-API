export const FLAME_TIERS=[
  {min:0,key:'ash',label:'Unranked',scale:1},
  {min:3,key:'spark',label:'Spark',scale:1},
  {min:7,key:'ember',label:'Ember',scale:1.15},
  {min:30,key:'blaze',label:'Blaze',scale:1.3},
  {min:90,key:'inferno',label:'Inferno',scale:1.5},
  {min:180,key:'hellfire',label:'Hellfire',scale:1.7},
  {min:365,key:'eternal',label:'Eternal Flame',scale:2},
] as const;
export function flameTier(days:number) {
  let tier:typeof FLAME_TIERS[number]=FLAME_TIERS[0];
  for(const candidate of FLAME_TIERS)if(Number.isFinite(days)&&days>=candidate.min)tier=candidate;
  return tier;
}

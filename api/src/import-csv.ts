import { calendar } from '@chudlog/shared';
import { exercises as catalogue } from './data/exercises.js';
import type { ExerciseInput } from './activity.js';
export interface ImportedWorkout {date:string;started_ts:number;exercises:ExerciseInput[];notes:string}
export interface ImportReport {workouts:ImportedWorkout[];errors:Array<{row:number;message:string}>;skipped:Array<{row:number;message:string}>;rows:number;assumed_timezone:string}
/** RFC-style quoted fields, escaped quotes, CRLF, BOM, and comma/semicolon exports. */
export function parseCsv(text:string):string[][] {
  if(Buffer.byteLength(text)>5*1024*1024)throw new Error('CSV exceeds 5 MB');
  const source=text.replace(/^\uFEFF/,''),delimiter=source.split(/\r?\n/,1)[0]!.includes(';')?';':',';
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
  for(let i=0;i<source.length;i++) {
    const ch=source[i]!;
    if(ch==='"') {
      if(quoted&&source[i+1]==='"'){field+='"';i++;}else if(!quoted&&field.length)throw new Error('unexpected quote in CSV field');else quoted=!quoted;
    } else if(ch===delimiter&&!quoted){row.push(field);field='';}
    else if((ch==='\n'||ch==='\r')&&!quoted) {
      if(ch==='\r'&&source[i+1]==='\n')i++;
      row.push(field);if(row.some(value=>value.trim()))rows.push(row);row=[];field='';
      if(rows.length>20001)throw new Error('CSV exceeds 20,000 data rows');
    }else field+=ch;
    if(field.length>20000)throw new Error('CSV field is too long');
  }
  if(quoted)throw new Error('unterminated quoted CSV field');
  row.push(field);if(row.some(value=>value.trim()))rows.push(row);
  if(rows.length>20001)throw new Error('CSV exceeds 20,000 data rows');
  return rows;
}
function timestamp(raw:string):number {
  // Date.parse normalizes impossible dates (for example February 30). Reject them first.
  const validParts=(year:number,month:number,day:number,hour:number,minute:number,second:number)=>{
    const check=new Date(Date.UTC(year,month-1,day));
    if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||hour>23||minute>59||second>59)throw new Error('invalid calendar date or time');
  };
  const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i);
  if(iso)validParts(Number(iso[1]),Number(iso[2]),Number(iso[3]),Number(iso[4]),Number(iso[5]),Number(iso[6]??0));
  if(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const stamp=iso?Date.parse(raw):NaN;if(Number.isFinite(stamp))return stamp;
  }
  let match=raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if(match)return Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]??'00'}+07:00`);
  match=raw.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4}),? (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if(match) {
    const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[2]!.toLowerCase())+1;
    validParts(Number(match[3]),month,Number(match[1]),Number(match[4]),Number(match[5]),Number(match[6]??0));
    if(month)return Date.parse(`${match[3]}-${String(month).padStart(2,'0')}-${match[1]!.padStart(2,'0')}T${match[4]}:${match[5]}:${match[6]??'00'}+07:00`);
  }
  throw new Error('unsupported date format; use an English export with ISO or DD Mon YYYY times');
}
export function previewCsv(source:'hevy'|'strong',text:string,now=Date.now()):ImportReport {
  const csv=parseCsv(text),header=csv.shift()?.map(value=>value.trim().toLowerCase());
  if(!header)throw new Error('CSV is empty');
  const columns=source==='hevy'?{date:'start_time',exercise:'exercise_title',kg:'weight_kg',reps:'reps',type:'set_type',rir:'rpe'}:{date:'date',exercise:'exercise name',kg:'weight',reps:'reps',type:'set order',rir:'rpe'};
  for(const key of [columns.date,columns.exercise,columns.kg,columns.reps])if(!header.includes(key))throw new Error(`missing ${key} column; ${source} English/kg exports are required`);
  const report:ImportReport={workouts:[],errors:[],skipped:[],rows:csv.length,assumed_timezone:'Asia/Jakarta for timestamps without an explicit offset'};
  const days=new Map<string,ImportedWorkout>();
  csv.forEach((values,index)=>{
    const row=index+2;
    try {
      if(values.length!==header.length)throw new Error('column count does not match header');
      const get=(key:string)=>(values[header.indexOf(key)]??'').trim();
      const reps=Number(get(columns.reps)),kg=get(columns.kg)===''?null:Number(get(columns.kg));
      if(!Number.isInteger(reps)||reps<1||reps>60) {report.skipped.push({row,message:'not a valid repetition-based set'});return;}
      if(kg!==null&&(!Number.isFinite(kg)||kg<0||kg>1000))throw new Error('invalid kg; pound exports are not supported');
      const started=timestamp(get(columns.date));
      if(!Number.isFinite(started)||started>now||started<Date.parse('2020-01-01'))throw new Error('invalid, future, or unsupported historical date');
      const date=calendar.calendarDate(started,'Asia/Jakarta'),exercise=get(columns.exercise);
      if(!exercise||exercise.length>80)throw new Error('exercise name is empty or too long');
      const warmup=/warm|^w$/i.test(get(columns.type));
      const rpe=Number(get(columns.rir));
      const rir=get(columns.rir)&&Number.isFinite(rpe)&&rpe>=1&&rpe<=10?String(Math.min(3,Math.round(10-rpe))):undefined;
      const workout=days.get(date)??{date,started_ts:started,exercises:[],notes:`${source} CSV import; unzoned times interpreted as WIB`};
      workout.started_ts=Math.min(workout.started_ts,started);
      let block=workout.exercises.find(block=>block.exercise===exercise);
      if(!block){block={exercise,muscle:catalogue.find(item=>item.name.toLowerCase()===exercise.toLowerCase())?.muscle??'unspecified',sets:[]};workout.exercises.push(block);}
      block.sets.push({kg,reps,warmup,...(rir?{rir:rir==='3'?'3+':rir}:{})});days.set(date,workout);
    }catch(error){report.errors.push({row,message:error instanceof Error?error.message:'invalid row'});}
  });
  for(const workout of days.values()) {
    if(workout.exercises.some(block=>block.sets.some(set=>!set.warmup)))report.workouts.push(workout);
    else report.skipped.push({row:0,message:`${workout.date}: only warm-up sets`});
  }
  report.workouts.sort((a,b)=>a.date.localeCompare(b.date));
  return report;
}

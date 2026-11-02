import type { ChildProcess,SpawnOptions } from 'node:child_process';
export function loadSettings(home:string,env?:NodeJS.ProcessEnv):{
  project:string;password:string;port:number;modelAccount:'test'|'runtime';settingsPath:string;
};
export function scrubEnvironment(env:NodeJS.ProcessEnv,home:string,apiKey?:string):NodeJS.ProcessEnv&{DSH_HOME:string};
export function redactOutput(text:string,secrets?:string[]):string;
export function lineWriter(write:(text:string)=>void,secrets?:string[]):{push(text:string):void;flush():void};
export function start(options?:{
  env?:NodeJS.ProcessEnv;root?:string;stdout?:(text:string)=>void;stderr?:(text:string)=>void;
  spawn?:(command:string,args:string[],options:SpawnOptions)=>Pick<ChildProcess,'stdout'|'stderr'|'once'|'kill'>;
}):{child:Pick<ChildProcess,'stdout'|'stderr'|'once'|'kill'>;home:string;port:number;cleanup():void};

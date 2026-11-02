import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const source=readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-workspace/client'),'utf8');
const begin=source.indexOf('async restoreSelection(workspaces, sessions) {');
const end=source.indexOf('async initializeDefaultWorkspace(signal)',begin);
assert.ok(begin>0&&end>begin,'Pinned rc.3 navigation contract changed');
// Execute the installed package's actual method against controlled service ports.
const restore=Function('recentWorkspace',`return ({${source.slice(begin,end)}}).restoreSelection;`)(()=>undefined);
test('native readonly client never creates default workspace or blank session on startup',async()=>{
  let creates=0;const selected:string[]=[];
  const context={ctx:{remoteAccess:{source:()=>({getSnapshot:()=>false})},layout:{beginNavigation:()=>new AbortController().signal}},
    selection:{getSnapshot:()=>({})},lifetime:new AbortController(),
    initializeDefaultWorkspace:async()=>{creates++;return undefined;},
    connectWorkspace:async()=>{creates++;},restoreBlank:async()=>{creates++;},
    replaceMain:(id:string)=>selected.push(id)};
  await restore.call(context,{items:[],archivedSessionIds:[]},{ids:[],byId:{}});
  assert.equal(creates,0);assert.deepEqual(selected,[]);
  context.selection.getSnapshot=()=>({sessionId:'worker-authorized'});
  await restore.call(context,{items:[],archivedSessionIds:[]},{ids:['worker-authorized'],byId:{'worker-authorized':{id:'worker-authorized',blank:false}}});
  assert.deepEqual(selected,['worker-authorized']);assert.equal(creates,0);
});

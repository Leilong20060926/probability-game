export function createLocalAdvisor(WorkerClass=globalThis.Worker) {
  let worker=null,nextId=0;
  const waiting=new Map();
  function stop(message) {for(const pending of waiting.values())pending.reject(new Error(message));waiting.clear();worker?.terminate();worker=null;}
  return {
    query(game) {
      if(!WorkerClass)return Promise.reject(new Error('此瀏覽器不支援背景提示計算，遊戲仍可繼續。'));
      if(!worker){
        worker=new WorkerClass(new URL('./route-hints-worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{const pending=waiting.get(data.id);if(!pending)return;waiting.delete(data.id);data.error?pending.reject(new Error(data.error)):pending.resolve(data.result);};
        worker.onerror=()=>stop('提示計算失敗，請重新嘗試；遊戲仍可繼續。');
      }
      const id=++nextId;
      return new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});worker.postMessage({id,game});});
    },
    dispose(){stop('提示已取消');},
  };
}

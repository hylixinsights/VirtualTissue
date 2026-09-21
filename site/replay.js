// Static recordings only. No simulation or inference provider is loaded here.
(async()=>{
 const requested=new URLSearchParams(location.search).get('recording');
 if(!requested)return;
 const error=document.getElementById('error'),filename=document.getElementById('filename');
 try{
  const indexURL=new URL('episodes/index.json',location.href);
  const response=await fetch(indexURL,{credentials:'omit',redirect:'error'});
  if(!response.ok)throw new Error('The recording catalog could not be loaded.');
  const catalog=await response.json();
  const entry=catalog.find(item=>item.scenario.id===requested||`episodes/${item.file}`===requested);
  if(!entry||!/^[-a-z0-9]+\.vt\.json\.gz$/.test(entry.file))throw new Error('This recording is not in the public demonstration catalog.');
  filename.textContent='Loading recording…';
  const result=await fetch(new URL(entry.file,indexURL),{credentials:'omit',redirect:'error'});
  if(!result.ok)throw new Error('The recording could not be downloaded.');
  const bytes=await result.arrayBuffer();
  await window.VirtualTissuePlayer.load(new File([bytes],entry.file,{type:'application/gzip'}));
  if(!window.VirtualTissuePlayer.episode)throw new Error(error.textContent||'The recording could not be decoded.');
  document.title=`${entry.scenario.title} · VirtualTissue replay`;
 }catch(cause){filename.textContent='No recording selected';error.textContent=`${cause.message} You can download an example from the home page and use Open recording.`;}
})();

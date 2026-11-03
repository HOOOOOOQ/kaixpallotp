const configs={
  users:{title:'Users',columns:[['ID',x=>x.id],['EMAIL',x=>x.email],['ROLE',x=>x.role],['STATUS',x=>x.status],['CREATED',x=>x.created_at]]},
  orders:{title:'Orders',columns:[['ID',x=>x.id],['USER',x=>x.user_id],['SERVICE',x=>x.service_ref],['COUNTRY',x=>x.country_ref],['AMOUNT',x=>`${x.currency} ${x.amount}`],['STATUS',x=>x.status]]},
  support:{title:'Support',columns:[['ID',x=>x.id],['USER',x=>x.user_id],['SUBJECT',x=>x.subject],['CATEGORY',x=>x.category],['STATUS',x=>x.status]]},
  audit:{title:'Audit logs',columns:[['ID',x=>x.id],['ACTOR',x=>x.actor_id || '—'],['ACTION',x=>x.action],['TARGET',x=>`${x.target_type} #${x.target_id}`],['CREATED',x=>x.created_at]]}
};
let view='overview', page=1, pages=1, request=0;
const setText=(id,value)=>{document.getElementById(id).textContent=value;};
function currentView(){const hash=location.hash.slice(1);return Object.hasOwn(configs,hash)?hash:'overview';}
async function load(nextPage=1) {
  const id=++request; view=currentView(); const title=view==='overview'?'Overview':configs[view].title;
  setText('breadcrumb',title); setText('title',title+'.'); setText('notice','Loading…');
  document.getElementById('overview').hidden=true; document.getElementById('data-panel').hidden=true; document.getElementById('admin-ticket').hidden=true;
  document.getElementById('refresh').disabled=true;
  const params=new URLSearchParams({page:String(nextPage),search:document.getElementById('search').value.trim()});
  try {
    const response=await fetch(`/api/admin/${view}?${params}`,{cache:'no-store'}); const data=await response.json();
    if(!response.ok) throw new Error(data.error || 'Unable to load data.');
    if(id!==request) return;
    if(view==='overview') {
      setText('stat-users',String(data.users));setText('stat-orders',String(data.orders.total));setText('stat-completed',String(data.orders.completed));setText('stat-pending',String(data.orders.pending));document.getElementById('overview').hidden=false;
    } else {
      const config=configs[view], head=document.getElementById('table-head'), body=document.getElementById('table-body');head.replaceChildren();body.replaceChildren();
      const row=document.createElement('tr');for(const [label] of config.columns){const th=document.createElement('th');th.textContent=label;row.append(th);}if(view==='users'||view==='support'){const th=document.createElement('th');th.textContent='ACTION';row.append(th);}head.append(row);
      if(!data.items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=config.columns.length+(['users','support'].includes(view)?1:0);td.className='empty';td.textContent='No records found.';tr.append(td);body.append(tr);}
      for(const item of data.items){const tr=document.createElement('tr');for(const [,value] of config.columns){const td=document.createElement('td');td.textContent=value(item) ?? '—';tr.append(td);}if(view==='users'){const td=document.createElement('td');if(['ACTIVE','SUSPENDED'].includes(item.status)&&item.role!=='OWNER'){const button=document.createElement('button');button.type='button';button.className='header-button';button.textContent=item.status==='ACTIVE'?'Suspend':'Restore';button.addEventListener('click',()=>changeUserStatus(item,button));td.append(button);}tr.append(td);}if(view==='support'){const td=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='header-button';button.textContent='Open';button.addEventListener('click',()=>openAdminTicket(item.id));td.append(button);tr.append(td);}body.append(tr);}
      page=data.page;pages=Math.max(1,Math.ceil(data.total/data.pageSize));setText('page-label',`Page ${page} of ${pages} · ${data.total} records`);
      document.getElementById('previous').disabled=page<=1;document.getElementById('next').disabled=page>=pages;setText('table-title',config.title);document.getElementById('data-panel').hidden=false;
    }
    setText('notice','Current database records. User status actions require additional permissions. Financial actions are disabled.');
  } catch(error){if(id===request)setText('notice',error.message || 'Unable to load data.');}
  finally {if(id===request)document.getElementById('refresh').disabled=false;}
}
window.addEventListener('hashchange',()=>{document.getElementById('search').value='';load(1);});
document.getElementById('filter').addEventListener('submit',event=>{event.preventDefault();load(1);});
document.getElementById('refresh').addEventListener('click',()=>load(page));
document.getElementById('previous').addEventListener('click',()=>{if(page>1)load(page-1);});
document.getElementById('next').addEventListener('click',()=>{if(page<pages)load(page+1);});
load();

async function changeUserStatus(user,button) {
  const action=user.status==='ACTIVE'?'suspend':'restore';
  if(!confirm(`${action==='suspend'?'Suspend':'Restore'} account ${user.email}?${action==='suspend'?' Active sessions will be revoked.':''}`)) return;
  button.disabled=true;setText('notice','Updating account…');
  try {
    const me=await fetch('/api/account/me',{cache:'no-store'});const session=await me.json();if(!me.ok)throw new Error(session.error||'Please sign in.');
    const response=await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/${action}`,{method:'POST',headers:{'X-CSRF-Token':session.csrf}});const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Unable to update account.');
    await load(page);setText('notice',`Account ${action==='suspend'?'suspended':'restored'}.`);
  } catch(error) {setText('notice',error.message||'Unable to update account.');} finally {button.disabled=false;}
}

let ticketId=null, ticketStatus=null, pendingReply=null;
const supportTransitions={OPEN:['IN_PROGRESS','RESOLVED','CLOSED'],IN_PROGRESS:['WAITING_FOR_CUSTOMER','RESOLVED','CLOSED'],WAITING_FOR_CUSTOMER:['IN_PROGRESS','RESOLVED','CLOSED'],RESOLVED:['IN_PROGRESS','CLOSED'],CLOSED:[]};
async function openAdminTicket(id){
  setText('notice','Loading ticket…');
  try{const response=await fetch(`/api/admin/support/${encodeURIComponent(id)}`,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load ticket.');
    ticketId=id;ticketStatus=data.ticket.status;const select=document.getElementById('ticket-status-select');select.replaceChildren();for(const status of (supportTransitions[ticketStatus]||[])){const option=document.createElement('option');option.value=status;option.textContent=status.replaceAll('_',' ');select.append(option);}document.querySelector('#ticket-status-form button').disabled=!select.options.length;document.getElementById('admin-ticket').hidden=false;setText('admin-ticket-title',`#${id} · ${data.ticket.subject}`);setText('admin-ticket-status',data.ticket.status.replaceAll('_',' '));
    const messages=document.getElementById('admin-ticket-messages');messages.replaceChildren();for(const message of data.messages){const item=document.createElement('p');item.textContent=`${message.is_private?'[Private] ':''}${message.body}`;messages.append(item);}
    document.querySelector('#admin-reply-form button').disabled=['CLOSED','RESOLVED'].includes(data.ticket.status);setText('notice','Ticket loaded.');
  }catch(error){setText('notice',error.message||'Unable to load ticket.');}
}
document.getElementById('admin-reply-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;if(!ticketId||!form.reportValidity())return;
  const message=document.getElementById('admin-reply').value.trim(),isPrivate=document.getElementById('admin-private').checked;
  if(!pendingReply||pendingReply.ticketId!==ticketId||pendingReply.message!==message||pendingReply.private!==isPrivate)pendingReply={ticketId,message,private:isPrivate,operationKey:crypto.randomUUID().replaceAll('-','')};
  const button=form.querySelector('button');button.disabled=true;setText('notice','Sending message…');
  try{const me=await fetch('/api/account/me',{cache:'no-store'}),session=await me.json();if(!me.ok)throw new Error(session.error||'Please sign in.');
    const response=await fetch(`/api/admin/support/${encodeURIComponent(ticketId)}`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify(pendingReply)}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to send message.');
    pendingReply=null;form.reset();await openAdminTicket(ticketId);setText('notice','Message saved.');
  }catch(error){setText('notice',error.message||'Unable to send message.');}finally{button.disabled=false;}
});

document.getElementById('ticket-status-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!ticketId||!ticketStatus)return;const next=document.getElementById('ticket-status-select').value;if(!next||!confirm(`Change ticket status to ${next.replaceAll('_',' ')}?`))return;
  const button=event.currentTarget.querySelector('button');button.disabled=true;setText('notice','Updating ticket…');
  try{const me=await fetch('/api/account/me',{cache:'no-store'}),session=await me.json();if(!me.ok)throw new Error(session.error||'Please sign in.');
    const response=await fetch(`/api/admin/support/${encodeURIComponent(ticketId)}/status`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({expectedStatus:ticketStatus,status:next})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to update ticket.');await openAdminTicket(ticketId);setText('notice','Ticket status updated.');
  }catch(error){setText('notice',error.message||'Unable to update ticket.');}finally{button.disabled=!(supportTransitions[ticketStatus]||[]).length;}
});

let csrf = '';
const text = (id, value) => { document.getElementById(id).textContent = value; };
function money(value, currency = 'IDR') {
  try { return `${currency} ${BigInt(value).toLocaleString('id-ID')}`; } catch { return '—'; }
}
function rows(id, data, columns) {
  const target = document.getElementById(id); target.replaceChildren();
  if (!data.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = columns.length; td.className = 'empty'; td.textContent = id === 'orders-body' ? 'No orders yet. Your activity will appear here.' : 'No transactions yet.'; tr.append(td); target.append(tr); return; }
  for (const item of data) {
    const tr = document.createElement('tr');
    for (const column of columns) { const td = document.createElement('td'); td.textContent = column(item); tr.append(td); }
    target.append(tr);
  }
}
async function load() {
  const refresh = document.getElementById('refresh-data'); refresh.disabled = true; text('notice', 'Refreshing account data…');
  try {
    const me = await fetch('/api/account/me', {cache:'no-store'});
    if (me.status === 401) { window.location.assign('/account'); return; }
    const user = await me.json(); if (!me.ok) throw new Error(user.error || 'Unable to load account.');
    csrf = user.csrf; text('side-email', user.email);
    const response = await fetch('/api/account/overview', {cache:'no-store'}); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load dashboard.');
    text('balance', data.wallet ? money(data.wallet.available, data.wallet.currency) : '—');
    text('reserved', data.wallet ? `Reserved: ${money(data.wallet.reserved, data.wallet.currency)}` : 'Wallet unavailable');
    text('total', String(data.counts.total || 0)); text('completed', String(data.counts.completed || 0)); text('pending', String(data.counts.pending || 0));
    rows('orders-body', data.orders, [x => `#${x.id}`, x => x.service_ref, x => x.country_ref, x => money(x.amount, x.currency), x => x.status.replaceAll('_', ' ')]);
    rows('ledger-body', data.ledger, [x => `#${x.id}`, x => x.entry_type, x => x.description, x => money(x.amount, x.currency)]);
    text('notice', 'Account data is up to date. Purchases and deposits are not enabled yet.');
    await Promise.all([loadTickets(), loadKeys(), loadOrders(1), loadNotifications(), loadTransactions(1), loadUsage()]);
  } catch (error) { text('notice', error.message || 'Connection failed. Please try again.'); }
  finally { refresh.disabled = false; }
}
document.getElementById('refresh-data').addEventListener('click', load);
document.getElementById('logout').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { const response = await fetch('/api/account/logout', {method:'POST', headers:{'X-CSRF-Token':csrf}}); if (response.status === 401 || response.ok) { window.location.assign('/account'); return; } const data = await response.json(); throw new Error(data.error || 'Unable to sign out.'); }
  catch (error) { text('notice', error.message || 'Unable to sign out.'); } finally { button.disabled = false; }
});
load();

let selectedTicket = null;
const feedback = message => text('support-feedback', message);
async function loadTickets() {
  const list = document.getElementById('ticket-list');
  try {
    const response = await fetch('/api/account/tickets', {cache:'no-store'}); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load tickets.');
    list.replaceChildren();
    if (!data.tickets.length) { list.textContent = 'No tickets yet.'; return; }
    for (const ticket of data.tickets) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ticket-link';
      const title = document.createElement('span'), status = document.createElement('small');
      title.textContent = `#${ticket.id} · ${ticket.subject}`; status.textContent = ticket.status.replaceAll('_', ' ');
      button.append(title, status); button.addEventListener('click', () => openTicket(ticket.id)); list.append(button);
    }
  } catch (error) { list.textContent = error.message || 'Unable to load tickets.'; }
}
async function openTicket(id) {
  feedback('Loading ticket…');
  try {
    const response = await fetch(`/api/account/tickets/${encodeURIComponent(id)}`, {cache:'no-store'}); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load ticket.');
    selectedTicket = id; document.getElementById('ticket-detail').hidden = false;
    text('ticket-subject', data.ticket.subject); text('ticket-status', `#${id} · ${data.ticket.status.replaceAll('_', ' ')}`);
    const messages = document.getElementById('ticket-messages'); messages.replaceChildren();
    for (const message of data.messages) { const p = document.createElement('p'); p.textContent = message.body; messages.append(p); }
    document.querySelector('#reply-form button').disabled = ['RESOLVED','CLOSED'].includes(data.ticket.status);
    feedback('');
  } catch (error) { feedback(error.message || 'Unable to load ticket.'); }
}
document.getElementById('ticket-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const button = form.querySelector('button'); button.disabled = true; feedback('Creating ticket…');
  try {
    const response = await fetch('/api/account/tickets', {method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrf}, body:JSON.stringify({subject:document.getElementById('ticket-input-subject').value, category:document.getElementById('ticket-category').value, message:document.getElementById('ticket-message').value})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to create ticket.');
    form.reset(); await loadTickets(); await openTicket(data.id); feedback('Ticket created.');
  } catch (error) { feedback(error.message || 'Unable to create ticket.'); } finally { button.disabled = false; }
});
document.getElementById('reply-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; if (!selectedTicket || !form.reportValidity()) return;
  const button = form.querySelector('button'); button.disabled = true; feedback('Sending reply…');
  try {
    const response = await fetch(`/api/account/tickets/${encodeURIComponent(selectedTicket)}`, {method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrf}, body:JSON.stringify({message:document.getElementById('reply').value})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to send reply.');
    form.reset(); await openTicket(selectedTicket); feedback('Reply sent.');
  } catch (error) { feedback(error.message || 'Unable to send reply.'); } finally { button.disabled = false; }
});

async function loadKeys() {
  const list = document.getElementById('key-list');
  try {
    const response = await fetch('/api/account/keys', {cache:'no-store'}); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load keys.');
    list.replaceChildren();
    if (!data.keys.length) { list.textContent = 'No API keys yet.'; return; }
    for (const key of data.keys) {
      const row = document.createElement('div'); row.className = 'key-row';
      const label = document.createElement('span'); label.textContent = `${key.name} · ${key.token_prefix}…${key.revoked_at ? ' · Revoked' : ''}`; row.append(label);
      if (!key.revoked_at) {
        const revoke = document.createElement('button'); revoke.type = 'button'; revoke.textContent = 'Revoke'; revoke.className = 'header-button';
        revoke.addEventListener('click', async () => {
          if (!confirm('Revoke this API key? Integrations using it will stop working.')) return;
          revoke.disabled = true; text('key-feedback', 'Revoking key…');
          try { const result = await fetch(`/api/account/keys/${encodeURIComponent(key.id)}/revoke`, {method:'POST', headers:{'X-CSRF-Token':csrf}}); const payload = await result.json(); if (!result.ok) throw new Error(payload.error || 'Unable to revoke key.'); await loadKeys(); text('key-feedback','Key revoked.'); }
          catch (error) { text('key-feedback',error.message || 'Unable to revoke key.'); } finally { revoke.disabled = false; }
        });
        const rotate=document.createElement('button');rotate.type='button';rotate.textContent='Rotate';rotate.className='header-button';
        rotate.addEventListener('click',async()=>{
          if(!confirm('Rotate this key? The old key stops working immediately. Copy the new secret once.'))return;
          rotate.disabled=true;revoke.disabled=true;text('key-feedback','Rotating key…');document.getElementById('key-secret-wrap').hidden=true;text('key-secret','');
          try{const response=await fetch(`/api/account/keys/${encodeURIComponent(key.id)}/rotate`,{method:'POST',headers:{'X-CSRF-Token':csrf}}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to rotate key.');text('key-secret',data.secret);document.getElementById('key-secret-wrap').hidden=false;await loadKeys();text('key-feedback','Key rotated. Copy your new secret now.');}
          catch(error){text('key-feedback',error.message||'Unable to rotate key.');}finally{rotate.disabled=false;revoke.disabled=false;}
        });row.append(rotate,revoke);
      }
      list.append(row);
    }
  } catch (error) { list.textContent = error.message || 'Unable to load keys.'; }
}
document.getElementById('key-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const scopes = [...form.querySelectorAll('input[name=scope]:checked')].map(input => input.value);
  if (!scopes.length) { text('key-feedback', 'Choose at least one scope.'); return; }
  const button = form.querySelector('button'); button.disabled = true; text('key-feedback','Creating key…');
  document.getElementById('key-secret-wrap').hidden = true; text('key-secret','');
  try {
    const response = await fetch('/api/account/keys', {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({name:document.getElementById('key-name').value,scopes})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to create key.');
    text('key-secret',data.secret); document.getElementById('key-secret-wrap').hidden = false; form.reset(); await loadKeys(); text('key-feedback','Key created.');
  } catch (error) { text('key-feedback',error.message || 'Unable to create key.'); } finally { button.disabled = false; }
});
document.getElementById('copy-key').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(document.getElementById('key-secret').textContent); text('key-feedback','Key copied.'); }
  catch { text('key-feedback','Unable to copy automatically. Select and copy the key instead.'); }
});

let orderPage = 1, orderPages = 1, orderRequest = 0;
async function loadOrders(page) {
  const request = ++orderRequest, message = document.getElementById('order-feedback');
  const prev = document.getElementById('order-previous'), next = document.getElementById('order-next');
  prev.disabled = true; next.disabled = true; message.textContent = 'Loading orders…';
  const params = new URLSearchParams({page:String(page),search:document.getElementById('order-search').value.trim(),status:document.getElementById('order-status').value});
  try {
    const response = await fetch(`/api/account/orders?${params}`, {cache:'no-store'}); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load orders.');
    if (request !== orderRequest) return;
    orderPage = data.page; orderPages = Math.max(1,Math.ceil(data.total/data.pageSize));
    const target = document.getElementById('history-body'); target.replaceChildren();
    if (!data.orders.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 6; cell.className = 'empty'; cell.textContent = 'No matching orders.'; row.append(cell); target.append(row); }
    for (const order of data.orders) {
      const row = document.createElement('tr');
      for (const value of [`#${order.id}`,order.service_ref,order.country_ref,money(order.amount,order.currency),order.status.replaceAll('_',' ')]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      const cell = document.createElement('td'), button = document.createElement('button'); button.type = 'button'; button.className = 'header-button'; button.textContent = 'View'; button.addEventListener('click', () => openOrder(order.id)); cell.append(button); row.append(cell); target.append(row);
    }
    document.getElementById('order-page').textContent = `Page ${orderPage} of ${orderPages} · ${data.total} orders`;
    message.textContent = ''; prev.disabled = orderPage <= 1; next.disabled = orderPage >= orderPages;
  } catch (error) { if (request === orderRequest) { message.textContent = error.message || 'Unable to load orders.'; prev.disabled = orderPage <= 1; next.disabled = orderPage >= orderPages; } }
}
async function openOrder(id) {
  const message = document.getElementById('order-feedback'); message.textContent = 'Loading order details…';
  try {
    const response = await fetch(`/api/account/orders/${encodeURIComponent(id)}`, {cache:'no-store'}); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load order.');
    document.getElementById('order-detail').hidden = false;
    document.getElementById('order-detail-summary').textContent = `#${data.order.id} · ${data.order.service_ref} · ${data.order.country_ref} · ${data.order.status.replaceAll('_',' ')} · ${money(data.order.amount,data.order.currency)}`;
    const events = document.getElementById('order-events'); events.replaceChildren();
    if (!data.events.length) events.textContent = 'No events recorded.';
    for (const event of data.events) { const item = document.createElement('p'); item.textContent = `${event.from_status || 'START'} → ${event.to_status} · ${event.created_at || ''}`; events.append(item); }
    message.textContent = '';
  } catch (error) { message.textContent = error.message || 'Unable to load order.'; }
}
document.getElementById('order-filter').addEventListener('submit', event => {event.preventDefault(); loadOrders(1);});
document.getElementById('order-previous').addEventListener('click', () => {if(orderPage>1) loadOrders(orderPage-1);});
document.getElementById('order-next').addEventListener('click', () => {if(orderPage<orderPages) loadOrders(orderPage+1);});

async function loadNotifications(){
  const list=document.getElementById('notification-list');
  try{const response=await fetch('/api/account/notifications',{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load notifications.');list.replaceChildren();
    if(!data.items.length){list.textContent='No notifications yet.';return;}
    for(const item of data.items){const row=document.createElement('div');row.className='key-row';const label=document.createElement('span');label.textContent=`${item.read_at?'':'● '}${item.title}`;row.append(label);
      if(!item.read_at){const button=document.createElement('button');button.type='button';button.className='header-button';button.textContent='Mark read';button.addEventListener('click',async()=>{button.disabled=true;try{const r=await fetch(`/api/account/notifications/${encodeURIComponent(item.id)}/read`,{method:'POST',headers:{'X-CSRF-Token':csrf}}),result=await r.json();if(!r.ok)throw new Error(result.error||'Unable to update.');await loadNotifications();text('notification-feedback','Marked as read.');}catch(error){text('notification-feedback',error.message||'Unable to update.');}finally{button.disabled=false;}});row.append(button);}
      list.append(row);
    }
  }catch(error){list.textContent=error.message||'Unable to load notifications.';}
}

let transactionPage=1,transactionPages=1,transactionRequest=0;
async function loadTransactions(page){
  const request=++transactionRequest,feedback=document.getElementById('transaction-feedback'),prev=document.getElementById('transaction-previous'),next=document.getElementById('transaction-next');
  prev.disabled=true;next.disabled=true;feedback.textContent='Loading transactions…';
  const params=new URLSearchParams({page:String(page),search:document.getElementById('transaction-search').value.trim()});
  try{const response=await fetch(`/api/account/transactions?${params}`,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load transactions.');if(request!==transactionRequest)return;
    transactionPage=data.page;transactionPages=Math.max(1,Math.ceil(data.total/data.pageSize));const body=document.getElementById('transaction-body');body.replaceChildren();
    if(!data.items.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=6;cell.className='empty';cell.textContent='No matching transactions.';row.append(cell);body.append(row);}
    for(const item of data.items){const row=document.createElement('tr');for(const value of [`#${item.id}`,item.entry_type,item.description,money(item.available_delta,item.currency),money(item.reserved_delta,item.currency)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}const cell=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='header-button';button.textContent='View';button.addEventListener('click',()=>openTransaction(item.id));cell.append(button);row.append(cell);body.append(row);}
    text('transaction-page',`Page ${transactionPage} of ${transactionPages} · ${data.total} transactions`);feedback.textContent='';prev.disabled=transactionPage<=1;next.disabled=transactionPage>=transactionPages;
  }catch(error){if(request===transactionRequest){feedback.textContent=error.message||'Unable to load transactions.';prev.disabled=transactionPage<=1;next.disabled=transactionPage>=transactionPages;}}
}
async function openTransaction(id){
  const feedback=document.getElementById('transaction-feedback');feedback.textContent='Loading transaction…';
  try{const response=await fetch(`/api/account/transactions/${encodeURIComponent(id)}`,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load transaction.');const t=data.transaction;
    document.getElementById('transaction-detail').hidden=false;text('transaction-summary',`#${t.id} · ${t.entry_type} · ${t.description}`);text('transaction-balances',`Available: ${money(t.previous_available,t.currency)} → ${money(t.new_available,t.currency)} · Reserved: ${money(t.previous_reserved,t.currency)} → ${money(t.new_reserved,t.currency)}`);text('transaction-reference',`Reference: ${t.reference_type} · ${t.reference_id} · ${t.created_at||''}`);feedback.textContent='';
  }catch(error){feedback.textContent=error.message||'Unable to load transaction.';}
}
document.getElementById('transaction-filter').addEventListener('submit',event=>{event.preventDefault();loadTransactions(1);});
document.getElementById('transaction-previous').addEventListener('click',()=>{if(transactionPage>1)loadTransactions(transactionPage-1);});
document.getElementById('transaction-next').addEventListener('click',()=>{if(transactionPage<transactionPages)loadTransactions(transactionPage+1);});

async function loadUsage(){
  const summary=document.getElementById('usage-summary'),body=document.getElementById('usage-body');
  try{const response=await fetch('/api/account/usage',{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load usage.');const a=data.summary;
    summary.textContent=`Last 24h: ${a.total} requests · ${a.successful} successful · ${a.denied} denied · ${a.limited} rate limited · ${a.average_ms} ms average`;
    body.replaceChildren();if(!data.items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='empty';td.textContent='No API requests recorded.';tr.append(td);body.append(tr);}
    for(const item of data.items){const tr=document.createElement('tr');for(const value of [item.key_name,item.endpoint,String(item.status_code),`${item.duration_ms} ms`,item.created_at||'']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}
  }catch(error){summary.textContent=error.message||'Unable to load usage.';body.replaceChildren();}
}

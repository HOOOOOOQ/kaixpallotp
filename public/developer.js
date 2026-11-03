document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
  const source=document.getElementById(button.dataset.copy),feedback=document.getElementById('copy-feedback');
  try {await navigator.clipboard.writeText(source.textContent);feedback.textContent='Example copied.';}
  catch {feedback.textContent='Copy unavailable. Select the example text to copy it.';}
}));

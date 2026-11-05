// Réplicas das funções do ImobiBrasil (copiadas do site real em 04/11/2026)
function telefoneComTodosDigitosIguais(t){var d=t.replace(/\D/g,'');return /^(\d)\1+$/.test(d);}
function validarTelefone(telefone){telefone=telefone.trim();const formatoCelular=/^\(\d{2}\)\s9\d{4}-\d{4}$/;const formatoFixo=/^\(\d{2}\)\s\d{5}-\d{3}$/;if(!formatoCelular.test(telefone)&&!formatoFixo.test(telefone)){return false;}if(telefoneComTodosDigitosIguais(telefone)){return false;}return true;}
function createCookie(){}
window.alerts=[];window.alert=function(m){window.alerts.push(m)};
// mini jQuery só para o módulo WhatsApp Lead
window.$=function(sel){var els=document.querySelectorAll(sel);return{fadeIn:function(){els.forEach(function(e){e.style.display='block'})},fadeOut:function(){els.forEach(function(e){e.style.display='none'})},click:function(fn){els.forEach(function(e){e.addEventListener('click',fn)})}}};
function valida_frmAPPWhats(){if((document.frmAPPWhats.nome.value=="")||(document.frmAPPWhats.telefone.value=="")){alert("Por favor, preencha todos os campos!");return(false);}else if(document.frmAPPWhats.telefone.value.length<15){alert("Por favor, preencha o telefone corretamente!");return(false);}else if(document.frmAPPWhats.telefone.value.length==15){$(".chat_window").fadeOut(200);return(true);}else{alert("Por favor, preencha os campos corretamente!");return(false);}}
document.addEventListener('DOMContentLoaded',function(){
  $("#btwhatsapp").click(function(){$(".chat_window").fadeIn(200)});
  if(document.getElementById('telefone1')){document.getElementById('telefone1').addEventListener('input',function(e){var x=e.target.value.replace(/\D/g,'').match(/(\d{0,2})(\d{0,5})(\d{0,4})/);e.target.value=!x[2]?x[1]:'('+x[1]+') '+x[2]+(x[3]?'-'+x[3]:'');});}
});

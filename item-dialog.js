function itemDialog(id, save){
    const dialog = document.getElementById(id);
    const form = dialog.querySelector("form");
    const message = dialog.querySelector(".dialog-message");
    const cancel = dialog.querySelector("[data-cancel]");
    const submit = dialog.querySelector('[type="submit"]');
    let busy = false;

    cancel.addEventListener("click",() => dialog.close());
    dialog.addEventListener("cancel",event => {
        if(busy) event.preventDefault();
    });
    form.addEventListener("submit",async event => {
        event.preventDefault();
        if(busy) return;
        busy = true;
        submit.disabled = true;
        cancel.disabled = true;
        message.textContent = "";
        try{
            await save();
            dialog.close();
        }catch(error){
            message.textContent = error.message || String(error);
        }finally{
            busy = false;
            submit.disabled = false;
            cancel.disabled = false;
        }
    });
    return {
        open(){
            if(dialog.open) return;
            message.textContent = "";
            dialog.showModal();
        },
        get openState(){ return dialog.open; }
    };
}

function openDialogFromHash(hash, open){
    if(location.hash === hash) open();
    window.addEventListener("hashchange",() => {
        if(location.hash === hash) open();
    });
}

function escapeItemText(value){
    return String(value ?? "").replace(/[&<>"']/g,character => ({
        "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[character]);
}

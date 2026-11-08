(() => {
    const type = document.body.dataset.recipeType;
    if(type !== "food" && type !== "household") throw new Error("Invalid recipe type.");
    const label = type === "food" ? "Food" : "Household";
    const sb = window.seshat.supabase;
    const get = id => document.getElementById(id);
    const dialog = get("recipeDialog");
    const form = get("recipeForm");
    const fields = ["title","category","ingredients","instructions","notes"];
    const bucket = sb.storage.from("seshat-recipe-attachments");
    const fileTypes = ["application/pdf","image/jpeg","image/png","image/webp","image/gif"];
    const maxFileSize = 10 * 1024 * 1024;
    let editingId = null;
    let recipes = [];
    let attachments = [];
    let busy = false;

    async function getUser(){
        const {data,error} = await sb.auth.getUser();
        if(error) throw error;
        if(!data.user) throw new Error("Please sign in to manage recipes.");
        return data.user;
    }

    function render(){
        const search = get("searchBox").value.trim().toLowerCase();
        const matches = recipes.filter(recipe => fields.some(field =>
            (recipe[field] || "").toLowerCase().includes(search)
        ));
        const list = get("recipeList");
        list.replaceChildren();
        get("listMessage").textContent = matches.length ? "" :
            (search ? "No recipes match your search." : "No recipes yet. Add one to get started.");
        for(const recipe of matches){
            const card = document.createElement("article");
            card.className = "recipe-card";
            const title = document.createElement("h2");
            title.textContent = recipe.title;
            card.append(title);
            if(recipe.category){
                const category = document.createElement("span");
                category.className = "badge";
                category.textContent = recipe.category;
                card.append(category);
            }
            for(const [field,heading] of [
                ["ingredients","Ingredients and quantities"],
                ["instructions","Instructions"],
                ["notes",type === "household" ? "Notes and precautions" : "Notes"]
            ]){
                if(!recipe[field]) continue;
                const section = document.createElement("section");
                const name = document.createElement("h3");
                name.textContent = heading;
                const text = document.createElement("p");
                text.className = "recipe-text";
                text.textContent = recipe[field];
                section.append(name,text);
                card.append(section);
            }
            const attachmentSection = document.createElement("section");
            attachmentSection.className = "attachments";
            const attachmentHeading = document.createElement("h3");
            attachmentHeading.textContent = "Images and PDFs";
            attachmentSection.append(attachmentHeading);
            const attachmentList = document.createElement("ul");
            attachmentList.className = "attachment-list";
            for(const attachment of attachments.filter(item => item.recipe_id === recipe.id)){
                const item = document.createElement("li");
                const name = document.createElement("span");
                name.textContent = attachment.file_name;
                const open = document.createElement("button");
                open.type = "button";
                open.className = "button open-attachment";
                open.textContent = "Open";
                open.addEventListener("click",() => openAttachment(attachment));
                const removeAttachment = document.createElement("button");
                removeAttachment.type = "button";
                removeAttachment.className = "button delete-button remove-attachment";
                removeAttachment.textContent = "Remove";
                removeAttachment.addEventListener("click",() => deleteAttachment(attachment,card));
                item.append(name,document.createElement("br"),open,removeAttachment);
                attachmentList.append(item);
            }
            attachmentSection.append(attachmentList);
            const uploadLabel = document.createElement("label");
            uploadLabel.textContent = "Select images or PDFs (up to 10 MB each)";
            const input = document.createElement("input");
            input.type = "file";
            input.className = "attachment-input";
            input.accept = ".pdf,image/jpeg,image/png,image/webp,image/gif";
            input.multiple = true;
            uploadLabel.append(input);
            const upload = document.createElement("button");
            upload.type = "button";
            upload.className = "button upload-attachment";
            upload.textContent = "Upload files";
            upload.addEventListener("click",() => uploadAttachments(recipe,input,card));
            const attachmentMessage = document.createElement("p");
            attachmentMessage.className = "message attachment-message";
            attachmentMessage.setAttribute("role","status");
            attachmentSection.append(uploadLabel,upload,attachmentMessage);
            card.append(attachmentSection);
            const actions = document.createElement("div");
            actions.className = "recipe-actions";
            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "button edit-button";
            edit.textContent = "Edit";
            edit.addEventListener("click",() => openEdit(recipe));
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "button delete-button";
            remove.textContent = "Delete";
            remove.addEventListener("click",() => deleteRecipe(recipe,card));
            actions.append(edit,remove);
            card.append(actions);
            list.append(card);
        }
    }

    async function loadRecipes(){
        const user = await getUser();
        const {data,error} = await sb.from("seshat_hub_recipes")
            .select("*").eq("user_id",user.id).eq("recipe_type",type)
            .order("updated_at",{ascending:false});
        if(error) throw error;
        const attachmentResult = await sb.from("seshat_hub_recipe_attachments")
            .select("*").eq("user_id",user.id).order("created_at",{ascending:true});
        if(attachmentResult.error) throw attachmentResult.error;
        recipes = data;
        attachments = attachmentResult.data;
        render();
    }

    function reportListError(error){
        get("listMessage").textContent = "Unable to load recipes: " + error.message;
    }

    function openCreate(){
        if(dialog.open) return;
        editingId = null;
        form.reset();
        get("dialogHeading").textContent = "Add " + label + " Recipe";
        get("formMessage").textContent = "";
        dialog.showModal();
    }

    function openEdit(recipe){
        if(dialog.open) return;
        editingId = recipe.id;
        fields.forEach(field => { get(field).value = recipe[field] || ""; });
        get("dialogHeading").textContent = "Edit " + label + " Recipe";
        get("formMessage").textContent = "";
        dialog.showModal();
    }

    get("createRecipe").addEventListener("click",openCreate);
    get("searchBox").addEventListener("input",render);
    get("cancelRecipe").addEventListener("click",() => dialog.close());
    dialog.addEventListener("cancel",event => {
        if(busy) event.preventDefault();
    });

    form.addEventListener("submit",async event => {
        event.preventDefault();
        if(busy) return;
        const title = get("title").value.trim();
        if(!title){
            get("formMessage").textContent = "Recipe name is required.";
            return;
        }
        busy = true;
        get("saveRecipe").disabled = true;
        get("cancelRecipe").disabled = true;
        get("formMessage").textContent = "";
        try{
            const user = await getUser();
            const values = Object.fromEntries(fields.map(field => [field,get(field).value]));
            values.title = title;
            values.updated_at = new Date().toISOString();
            let result;
            if(editingId !== null){
                result = await sb.from("seshat_hub_recipes").update(values)
                    .eq("id",editingId).eq("user_id",user.id).eq("recipe_type",type).select("id");
                if(!result.error && result.data.length !== 1) throw new Error("Recipe was not found or is no longer accessible.");
            }else{
                result = await sb.from("seshat_hub_recipes").insert({...values,user_id:user.id,recipe_type:type});
            }
            if(result.error) throw result.error;
            dialog.close();
            form.reset();
            loadRecipes().catch(reportListError);
        }catch(error){
            get("formMessage").textContent = "Unable to save recipe: " + error.message;
        }finally{
            busy = false;
            get("saveRecipe").disabled = false;
            get("cancelRecipe").disabled = false;
        }
    });

    function setCardBusy(card,value){
        card.querySelectorAll("button,input").forEach(control => { control.disabled = value; });
    }

    async function openAttachment(attachment){
        const popup = window.open("about:blank","_blank");
        if(!popup){
            get("listMessage").textContent = "Allow pop-ups to open an attachment.";
            return;
        }
        try{
            const {data,error} = await bucket.createSignedUrl(attachment.storage_path,60);
            if(error) throw error;
            popup.opener = null;
            popup.location.replace(data.signedUrl);
        }catch(error){
            popup.close();
            get("listMessage").textContent = "Unable to open attachment: " + error.message;
        }
    }

    async function removeAttachment(attachment,user){
        const {error:storageError} = await bucket.remove([attachment.storage_path]);
        if(storageError) throw storageError;
        const {data,error} = await sb.from("seshat_hub_recipe_attachments").delete()
            .eq("id",attachment.id).eq("user_id",user.id).select("id");
        if(error) throw error;
        if(data.length !== 1) throw new Error("Attachment is no longer accessible.");
    }

    async function uploadAttachments(recipe,input,card){
        const message = card.querySelector(".attachment-message");
        const files = [...input.files];
        if(!files.length){
            message.textContent = "Select at least one file.";
            return;
        }
        const invalid = files.find(file => !fileTypes.includes(file.type) || file.size > maxFileSize);
        if(invalid){
            message.textContent = invalid.name + ": use a PDF, JPEG, PNG, GIF or WebP up to 10 MB.";
            return;
        }
        setCardBusy(card,true);
        message.textContent = "Uploading...";
        let uploaded = 0;
        try{
            const user = await getUser();
            for(const file of files){
                const path = `${user.id}/${recipe.id}/${crypto.randomUUID()}`;
                const {error:uploadError} = await bucket.upload(path,file,{contentType:file.type});
                if(uploadError) throw new Error(file.name + ": " + uploadError.message);
                try{
                    const {error} = await sb.from("seshat_hub_recipe_attachments").insert({
                        recipe_id:recipe.id,user_id:user.id,file_name:file.name,storage_path:path
                    });
                    if(error) throw error;
                }catch(error){
                    const {error:cleanupError} = await bucket.remove([path]);
                    if(cleanupError) throw new Error(file.name + ": " + error.message + "; uploaded file cleanup failed: " + cleanupError.message);
                    throw new Error(file.name + ": " + error.message);
                }
                uploaded++;
            }
        }catch(error){
            input.value = "";
            try{
                await loadRecipes();
                get("listMessage").textContent = uploaded + " file(s) uploaded. Upload stopped: " + error.message +
                    " Select remaining files to retry.";
            }catch(refreshError){
                message.textContent = "Upload stopped: " + error.message + ". Refresh failed: " + refreshError.message;
                setCardBusy(card,false);
            }
            return;
        }
        try{
            await loadRecipes();
            get("listMessage").textContent = uploaded + (uploaded === 1 ? " file uploaded." : " files uploaded.");
        }catch(error){
            input.value = "";
            message.textContent = uploaded + " file(s) uploaded, but the list could not be refreshed: " + error.message;
            setCardBusy(card,false);
        }
    }

    async function deleteAttachment(attachment,card){
        if(!confirm("Remove this attachment?")) return;
        setCardBusy(card,true);
        try{
            const user = await getUser();
            await removeAttachment(attachment,user);
            await loadRecipes();
        }catch(error){
            card.querySelector(".attachment-message").textContent = "Unable to remove or refresh attachment: " + error.message;
            setCardBusy(card,false);
        }
    }

    async function deleteRecipe(recipe,card){
        if(!confirm("Delete this recipe?")) return;
        setCardBusy(card,true);
        try{
            const user = await getUser();
            for(const attachment of attachments.filter(item => item.recipe_id === recipe.id)){
                await removeAttachment(attachment,user);
            }
            const {data,error} = await sb.from("seshat_hub_recipes").delete()
                .eq("id",recipe.id).eq("user_id",user.id).eq("recipe_type",type).select("id");
            if(error) throw error;
            if(data.length !== 1) throw new Error("Recipe was not found or is no longer accessible.");
            await loadRecipes();
        }catch(error){
            get("listMessage").textContent = "Unable to delete or refresh recipe: " + error.message;
            try{
                await loadRecipes();
                get("listMessage").textContent = "Unable to delete or refresh recipe: " + error.message;
            }catch(refreshError){
                get("listMessage").textContent += ". Refresh failed: " + refreshError.message;
                setCardBusy(card,false);
            }
        }
    }

    get("listMessage").textContent = "Loading recipes...";
    loadRecipes().catch(reportListError);
})();

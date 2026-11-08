(() => {
    const type = document.body.dataset.recipeType;
    if(type !== "food" && type !== "household") throw new Error("Invalid recipe type.");
    const label = type === "food" ? "Food" : "Household";
    const sb = window.seshat.supabase;
    const get = id => document.getElementById(id);
    const dialog = get("recipeDialog");
    const form = get("recipeForm");
    const fields = ["title","category","ingredients","instructions","notes"];
    let editingId = null;
    let recipes = [];
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
            remove.addEventListener("click",() => deleteRecipe(recipe,remove));
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
        recipes = data;
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

    async function deleteRecipe(recipe,button){
        if(!confirm("Delete this recipe?")) return;
        button.disabled = true;
        try{
            const user = await getUser();
            const {data,error} = await sb.from("seshat_hub_recipes").delete()
                .eq("id",recipe.id).eq("user_id",user.id).eq("recipe_type",type).select("id");
            if(error) throw error;
            if(data.length !== 1) throw new Error("Recipe was not found or is no longer accessible.");
            await loadRecipes();
        }catch(error){
            get("listMessage").textContent = "Unable to delete or refresh recipe: " + error.message;
            button.disabled = false;
        }
    }

    get("listMessage").textContent = "Loading recipes...";
    loadRecipes().catch(reportListError);
})();

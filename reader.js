(() => {
    const $ = id => document.getElementById(id);
    const storageKey = "seshat-reader-v1";
    const maxSize = 50 * 1024 * 1024;
    const themes = {
        light:{background:"#ffffff",color:"#1e293b"},
        sepia:{background:"#f4ecd8",color:"#3e3022"},
        dark:{background:"#171717",color:"#e5e5e5"}
    };
    let data = {books:[],size:100,theme:"light"};
    let book, rendition, current, touchStart, loading = false;

    try{
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if(saved && Array.isArray(saved.books)){
            data.books = saved.books.filter(item => item && typeof item.key === "string" && typeof item.title === "string").slice(0,30);
            if(Number.isFinite(saved.size)) data.size = Math.min(180,Math.max(80,saved.size));
            if(Object.hasOwn(themes,saved.theme)) data.theme = saved.theme;
        }
    }catch(error){
        $("libraryMessage").textContent = "Could not load saved reader settings: " + error.message;
    }

    function save(){
        try{
            localStorage.setItem(storageKey,JSON.stringify(data));
        }catch(error){
            const target = $("reader").hidden ? $("libraryMessage") : $("readerMessage");
            target.textContent = "Unable to save reading position or settings on this device: " + error.message;
        }
    }

    function parseArchive(input){
        const text = input.trim();
        if(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(text)) return text;
        let url;
        try{ url = new URL(text); }catch(error){ throw new Error("Enter an Internet Archive item URL or identifier."); }
        if(url.protocol !== "https:" || url.hostname !== "archive.org" || url.username || url.password)
            throw new Error("Use an https://archive.org/details/ link.");
        const match = url.pathname.match(/^\/details\/([a-zA-Z0-9][a-zA-Z0-9_.-]*)\/?$/);
        if(!match) throw new Error("Use an Internet Archive item link such as https://archive.org/details/identifier.");
        return match[1];
    }

    function isPublicEpub(file){
        return file && typeof file.name === "string" && /\.epub$/i.test(file.name) &&
            !["true","1","yes"].includes(String(file.private || "").toLowerCase()) &&
            file.name.length <= 500 && !file.name.split("/").some(part => !part || part === "." || part === "..") &&
            (!file.size || (Number.isFinite(Number(file.size)) && Number(file.size) <= maxSize));
    }

    function archiveUrl(id,name){
        if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id) || !isPublicEpub({name}))
            throw new Error("Invalid Internet Archive book link.");
        return "https://archive.org/download/" + encodeURIComponent(id) + "/" +
            name.split("/").map(encodeURIComponent).join("/");
    }

    function button(label,action){
        const element = document.createElement("button");
        element.type = "button";
        element.className = "button secondary";
        element.textContent = label;
        element.addEventListener("click",action);
        return element;
    }

    function showRecent(){
        const list = $("recentBooks");
        list.replaceChildren();
        if(!data.books.length){
            list.textContent = "No recent books yet.";
            return;
        }
        for(const entry of data.books){
            const row = document.createElement("div");
            row.className = "book-row";
            const name = document.createElement("span");
            name.textContent = entry.title + (entry.kind === "local" ? " (select file again to resume)" : "");
            const actions = document.createElement("div");
            actions.className = "book-actions";
            if(entry.kind === "archive"){
                actions.append(button("Read",() => openArchive(entry)));
            }
            actions.append(button("Remove",() => {
                data.books = data.books.filter(item => item.key !== entry.key);
                save();
                showRecent();
            }));
            row.append(name,actions);
            list.append(row);
        }
    }

    async function getResponse(url){
        const response = await fetch(url,{credentials:"omit",redirect:"follow"});
        if(!response.ok) throw new Error("Internet Archive returned HTTP " + response.status + ".");
        return response;
    }

    $("archiveForm").addEventListener("submit",async event => {
        event.preventDefault();
        $("archiveMessage").textContent = "";
        $("archiveResults").replaceChildren();
        $("findBook").disabled = true;
        try{
            const id = parseArchive($("archiveLink").value);
            const response = await getResponse("https://archive.org/metadata/" + encodeURIComponent(id));
            const metadata = await response.json();
            const files = Array.isArray(metadata.files) ? metadata.files.filter(isPublicEpub) : [];
            if(!files.length) throw new Error("No freely downloadable EPUB (up to 50 MB) was listed for this item.");
            const title = typeof metadata.metadata?.title === "string" ? metadata.metadata.title : id;
            $("archiveMessage").textContent = "Select an available EPUB:";
            for(const file of files){
                const row = document.createElement("div");
                row.className = "book-row";
                const name = document.createElement("span");
                name.textContent = file.name;
                const entry = {key:"archive:" + id + "/" + file.name,kind:"archive",id,file:file.name,title};
                row.append(name,button("Read",() => openArchive(entry)));
                $("archiveResults").append(row);
            }
        }catch(error){
            $("archiveMessage").textContent = "Could not find EPUBs: " + error.message +
                " You can download an available EPUB from Internet Archive and open the file below.";
        }finally{
            $("findBook").disabled = false;
        }
    });

    async function openArchive(entry){
        if(loading) return;
        loading = true;
        $("libraryMessage").textContent = "Loading book…";
        try{
            const response = await getResponse(archiveUrl(entry.id,entry.file));
            const length = Number(response.headers.get("content-length"));
            if(length > maxSize) throw new Error("This EPUB exceeds the 50 MB limit.");
            const bytes = await response.arrayBuffer();
            if(bytes.byteLength > maxSize) throw new Error("This EPUB exceeds the 50 MB limit.");
            await openBook(bytes,entry);
        }catch(error){
            $("libraryMessage").textContent = "Could not open EPUB: " + error.message +
                " If the browser blocks the download, download the EPUB from Internet Archive and choose the file below.";
        }finally{ loading = false; }
    }

    $("localBook").addEventListener("change",async event => {
        const file = event.target.files[0];
        if(!file || loading) return;
        loading = true;
        $("libraryMessage").textContent = "Loading book…";
        try{
            if(!/\.epub$/i.test(file.name)) throw new Error("Choose an EPUB file.");
            if(file.size > maxSize) throw new Error("This EPUB exceeds the 50 MB limit.");
            const bytes = await file.arrayBuffer();
            const hash = await crypto.subtle.digest("SHA-256",bytes);
            const key = "local:" + [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2,"0")).join("");
            await openBook(bytes,{key,kind:"local",title:file.name});
        }catch(error){
            $("libraryMessage").textContent = "Could not open EPUB: " + error.message;
        }finally{
            loading = false;
            event.target.value = "";
        }
    });

    function applyAppearance(){
        $("reader").dataset.theme = data.theme;
        $("theme").value = data.theme;
        $("textSize").textContent = data.size + "%";
        if(rendition){
            const theme = themes[data.theme];
            rendition.themes.default({
                body:{"background":theme.background + " !important","color":theme.color + " !important"},
                "p, li, div, span, h1, h2, h3, h4, h5, h6":{"color":theme.color + " !important"}
            });
            rendition.themes.fontSize(data.size + "%");
        }
    }

    function setToc(items,depth = 0){
        for(const item of items || []){
            if(item.href){
                const option = document.createElement("option");
                option.value = item.href;
                option.textContent = "— ".repeat(depth) + (item.label || item.href).trim();
                $("chapter").append(option);
            }
            setToc(item.subitems,depth + 1);
        }
    }

    async function openBook(bytes,entry){
        if(typeof window.ePub !== "function" || typeof window.JSZip !== "function")
            throw new Error("Reader libraries did not load. Check your connection and reload the page.");
        if(book) book.destroy();
        book = window.ePub();
        current = {...entry,...data.books.find(item => item.key === entry.key)};
        $("viewer").replaceChildren();
        $("bookTitle").textContent = current.title;
        $("chapter").replaceChildren(new Option("Select a chapter",""));
        $("readerMessage").textContent = "";
        $("library").hidden = true;
        $("reader").hidden = false;
        $("reader").setAttribute("aria-busy","true");
        $("backToLibrary").disabled = true;
        $("showSettings").disabled = true;
        $("previousPage").disabled = true;
        $("nextPage").disabled = true;
        try{
            await book.open(bytes,"binary");
            await book.ready;
            rendition = book.renderTo("viewer",{
                width:"100%",height:"100%",flow:"paginated",spread:"none",
                allowScriptedContent:false,allowPopups:false
            });
            applyAppearance();
            rendition.on("relocated",location => {
                if(!location?.start?.cfi || !current) return;
                current.cfi = location.start.cfi;
                $("location").textContent = location.start.displayed ?
                    "Page " + location.start.displayed.page + " of " + location.start.displayed.total + " in chapter" : "";
                data.books = [current,...data.books.filter(item => item.key !== current.key)].slice(0,30);
                save();
            });
            rendition.on("keyup",handleKey);
            rendition.on("touchstart",event => { touchStart = event.changedTouches[0]; });
            rendition.on("touchend",event => {
                if(!touchStart) return;
                const end = event.changedTouches[0];
                const dx = end.screenX - touchStart.screenX;
                const dy = end.screenY - touchStart.screenY;
                touchStart = null;
                if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? "next" : "prev");
            });
            const navigation = await book.loaded.navigation;
            setToc(navigation?.toc);
            try{
                await rendition.display(current.cfi || undefined);
            }catch(error){
                if(!current.cfi) throw error;
                current.cfi = "";
                $("readerMessage").textContent = "The saved position was unavailable; opened at the beginning.";
                await rendition.display();
            }
            data.books = [current,...data.books.filter(item => item.key !== current.key)].slice(0,30);
            save();
            $("libraryMessage").textContent = "";
        }catch(error){
            book.destroy();
            book = null;
            rendition = null;
            current = null;
            $("reader").hidden = true;
            $("library").hidden = false;
            throw error;
        }finally{
            $("reader").removeAttribute("aria-busy");
            $("backToLibrary").disabled = false;
            $("showSettings").disabled = false;
            $("previousPage").disabled = false;
            $("nextPage").disabled = false;
        }
    }

    function turn(direction){
        if(rendition) rendition[direction]().catch(error => {
            $("readerMessage").textContent = "Unable to turn page: " + error.message;
        });
    }
    function handleKey(event){
        if(event.key === "ArrowRight") turn("next");
        if(event.key === "ArrowLeft") turn("prev");
    }
    document.addEventListener("keyup",event => {
        if(!$("reader").hidden && !/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) handleKey(event);
    });
    $("previousPage").addEventListener("click",() => turn("prev"));
    $("nextPage").addEventListener("click",() => turn("next"));
    $("chapter").addEventListener("change",event => {
        if(event.target.value && rendition) rendition.display(event.target.value).catch(error => {
            $("readerMessage").textContent = "Unable to open chapter: " + error.message;
        });
    });
    $("showSettings").addEventListener("click",() => {
        $("readerSettings").hidden = !$("readerSettings").hidden;
        $("showSettings").setAttribute("aria-expanded",String(!$("readerSettings").hidden));
    });
    $("smallerText").addEventListener("click",() => { data.size = Math.max(80,data.size - 10); applyAppearance(); save(); });
    $("largerText").addEventListener("click",() => { data.size = Math.min(180,data.size + 10); applyAppearance(); save(); });
    $("theme").addEventListener("change",event => { data.theme = event.target.value; applyAppearance(); save(); });
    $("readingView").addEventListener("click",() => {
        $("readerSettings").hidden = true;
        $("showSettings").setAttribute("aria-expanded","false");
        $("reader").classList.add("reading-view");
        $("showToolbars").hidden = false;
    });
    $("showToolbars").addEventListener("click",() => {
        $("reader").classList.remove("reading-view");
        $("showToolbars").hidden = true;
    });
    $("fullscreen").addEventListener("click",async () => {
        try{
            if(document.fullscreenElement) await document.exitFullscreen();
            else if($("reader").requestFullscreen) await $("reader").requestFullscreen();
            else throw new Error("Full screen is not supported by this browser.");
        }catch(error){ $("readerMessage").textContent = "Unable to enter full screen: " + error.message; }
    });
    $("backToLibrary").addEventListener("click",() => {
        if(book) book.destroy();
        book = null;
        rendition = null;
        current = null;
        $("reader").hidden = true;
        $("reader").classList.remove("reading-view");
        $("showToolbars").hidden = true;
        $("readerSettings").hidden = true;
        $("showSettings").setAttribute("aria-expanded","false");
        $("library").hidden = false;
        showRecent();
    });
    showRecent();
})();

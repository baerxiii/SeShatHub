const foliate = "https://cdn.jsdelivr.net/gh/johnfactotum/foliate-js@78914aef4466eb960965702401634c2cb348e9b1";
const bookPolicy = "default-src 'none'; img-src blob: data:; media-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:; script-src 'none'; form-action 'none'; base-uri 'none'";

async function checkMobi(file) {
    const header = new DataView(await file.slice(0, 86).arrayBuffer());
    if (header.byteLength < 86 || header.getUint16(76) < 1) {
        throw new Error("This is not a valid MOBI file.");
    }
    const offset = header.getUint32(78);
    if (offset + 16 > file.size) throw new Error("This MOBI file is incomplete.");
    const record = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
    if (record.getUint16(12) !== 0) {
        throw new Error("This MOBI book is DRM-protected and cannot be opened.");
    }
}

function protectSections(book, urls) {
    for (const section of book.sections) {
        if (!section.load) continue;
        const load = section.load.bind(section);
        let safeUrl;
        section.load = async () => {
            if (safeUrl) return safeUrl;
            const response = await fetch(await load());
            if (!response.ok) throw new Error("Could not load a MOBI section.");
            const text = await response.text();
            const doc = new DOMParser().parseFromString(text, "text/html");
            doc.querySelectorAll("base, iframe, frame, object, embed, meta[http-equiv]").forEach(node => node.remove());
            const policy = doc.createElement("meta");
            policy.httpEquiv = "Content-Security-Policy";
            policy.content = bookPolicy;
            doc.head.prepend(policy);
            safeUrl = URL.createObjectURL(new Blob(
                ["<!DOCTYPE html>", doc.documentElement.outerHTML], { type: "text/html" }
            ));
            urls.add(safeUrl);
            return safeUrl;
        };
    }
}

export async function openMobiBook(file, container) {
    let modules;
    try {
        modules = await Promise.all([
            import(`${foliate}/mobi.js`),
            import(`${foliate}/vendor/fflate.js`),
            import(`${foliate}/view.js`)
        ]);
    } catch (error) {
        console.error("MOBI reader libraries could not be loaded:", error);
        throw new Error("The MOBI reader library could not be loaded. Check your internet connection and reload the page.");
    }

    const [{ MOBI, isMOBI }, { unzlibSync }] = modules;
    if (!await isMOBI(file)) throw new Error("This is not a valid MOBI file.");
    await checkMobi(file);

    const urls = new Set();
    let book;
    let view;
    let loaded = false;
    let fontSize = 100;
    let fontStyle;
    let navigation = Promise.resolve();
    const navigate = action => {
        const result = navigation.then(action);
        navigation = result.catch(error => console.error("MOBI navigation failed:", error));
        return result;
    };
    const destroy = async () => {
        await navigation;
        if (view?.renderer && loaded) view.close();
        view?.remove();
        book?.destroy();
        for (const url of urls) URL.revokeObjectURL(url);
        urls.clear();
    };

    try {
        book = await new MOBI({ unzlib: unzlibSync }).open(file);
        protectSections(book, urls);
        view = document.createElement("foliate-view");
        Object.assign(view.style, { display: "block", width: "100%", height: "100%" });
        view.addEventListener("external-link", event => event.preventDefault());
        view.addEventListener("load", event => {
            loaded = true;
            fontStyle = event.detail.doc.createElement("style");
            fontStyle.textContent = `html { font-size: ${fontSize}% !important; }`;
            event.detail.doc.head.append(fontStyle);
        });
        container.append(view);
        await view.open(book);
        const first = book.sections.findIndex(section => section.linear !== "no" && section.load);
        if (first < 0) throw new Error("This MOBI book has no readable sections.");
        await view.renderer.goTo({ index: first });
        if (!loaded) throw new Error("The MOBI book could not be rendered.");
        return {
            toc: book.toc || [],
            fixedLayout: view.isFixedLayout,
            prev: () => navigate(() => view.prev()),
            next: () => navigate(() => view.next()),
            goTo: href => navigate(async () => {
                const target = await book.resolveHref(href);
                if (!target) throw new Error("The selected chapter could not be found.");
                await view.renderer.goTo(target);
            }),
            setFontSize: size => {
                fontSize = size;
                if (fontStyle) fontStyle.textContent = `html { font-size: ${fontSize}% !important; }`;
            },
            destroy
        };
    } catch (error) {
        await destroy();
        console.error("Could not open MOBI book:", error);
        throw new Error("Could not open this MOBI book. It may be damaged, DRM-protected, or use an unsupported format.");
    }
}

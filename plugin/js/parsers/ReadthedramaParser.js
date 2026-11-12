"use strict";

parserFactory.register("readthedrama.com", () => new ReadthedramaParser());

/**
 * Parser for http://readthedrama.com/.
 */
class ReadthedramaParser extends Parser { // eslint-disable-line no-unused-vars
    constructor() {
        super();
        this.minimumThrottle = 9000;
        this.tocTitles = new Map();
    }

    /**
     * @param { Document } dom 
     */
    async getChapterUrls(dom) {
        /** @type { NodeListOf<HTMLAnchorElement> } */
        const found = dom.querySelectorAll("div.divide-y a");

        return Array.from(found, anchor => {
            let title = anchor.querySelector("span:first-of-type").textContent.trim();
            this.tocTitles.set(anchor.href, title);
            return {
                sourceUrl: anchor.href,
                title: title
            };
        });
    }

    /**
     * @param { Document } dom 
     */
    findContent(dom) {
        return dom.querySelector("article.chapter-text");
    }

    async fetchChapter(url) {
        let dom = await super.fetchChapter(url);
        let text = await ReadthedramaParser.decodeChapter(dom);
        let article = dom.createElement("article");
        article.className = "chapter-text";

        let titleText = dom.querySelector("h2.font-bold")?.textContent.replace(/\s+/g, " ").trim()
            || this.tocTitles.get(url);
        if (titleText) {
            let title = dom.createElement("h1");
            title.textContent = titleText;
            article.appendChild(title);
        }

        let paragraphs = text
            .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]/g, " ")
            .split("\n\n")
            .filter(p => p.trim() !== "");
        for (let paragraph of paragraphs) {
            let p = dom.createElement("p");
            p.textContent = paragraph.trim();
            article.appendChild(p);
        }
        dom.body.appendChild(article);
        return dom;
    }

    static getFlightPayload(dom) {
        let payload = "";
        for (let script of dom.querySelectorAll("script")) {
            let match = /^self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?$/.exec(script.textContent.trim());
            if (!match) {
                continue;
            }
            try {
                let entry = JSON.parse(match[1]);
                if (entry[0] === 1 && typeof entry[1] === "string") {
                    payload += entry[1];
                }
            } catch (e) {
                // not a flight chunk, skip
            }
        }
        return payload;
    }

    static async decodeChapter(dom) {
        const KEY = "rtd-ch-9f3a71c4d8e25b06";
        let payload = ReadthedramaParser.getFlightPayload(dom);

        let ref = /"encodedContent":"\$([0-9a-f]+)"/.exec(payload);
        let meta = /"novelSlug":"([^"]+)","chapterNumber":(\d+)/.exec(payload);
        if (!ref || !meta) {
            throw new Error("Could not find encoded chapter data in page.");
        }
        let header = new RegExp("(?:^|\\n)" + ref[1] + ":T([0-9a-f]+),").exec(payload);
        if (!header) {
            throw new Error("Could not find encoded chapter blob in page.");
        }
        let start = header.index + header[0].length;
        let blob = payload.substr(start, parseInt(header[1], 16));

        let binary = atob(blob);
        let bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; ++i) {
            bytes[i] = binary.charCodeAt(i);
        }

        let seedText = KEY + ":" + meta[1] + ":" + meta[2];
        let s = 0x811c9dc5;
        for (let i = 0; i < seedText.length; ++i) {
            s ^= seedText.charCodeAt(i);
            s = Math.imul(s, 0x1000193);
        }
        s = (s >>> 0) || 0x9e3779b9;

        let xored = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; ++i) {
            s ^= s << 13;
            s >>>= 0;
            s ^= s >>> 17;
            s ^= s << 5;
            s >>>= 0;
            xored[i] = bytes[i] ^ (255 & s);
        }

        let stream = new Blob([xored]).stream().pipeThrough(new DecompressionStream("deflate"));
        let inflated = new Uint8Array(await new Response(stream).arrayBuffer());
        return new TextDecoder().decode(inflated);
    }

    /**
     * @param { Document } dom 
     */
    extractDescription(dom) {
        /** @type { HTMLMetaElement } */
        return dom.querySelector("meta[property='og:description']")?.content;
    }

    /**
     * @param { Document } dom 
     */
    extractSubject(dom) {
        /** @type { NodeListOf<HTMLDivElement> } */
        const tagContainers = dom.querySelectorAll("div.text-xs.border-none");

        return Array.from(tagContainers, container => container.innerHTML.trim()).join(", ");
    }

    /**
     * @param { Document } dom 
     */
    extractAuthor(dom) {
        /** @type { HTMLParagraphElement } */
        const found = dom.querySelector("p.mb-2");

        return /\sby\s(.*)/.exec(found.textContent.trim())?.[1]?.trim();
    }

    /**
     * @param { Document } dom 
     */
    findCoverImageUrl(dom) {
        /** @type { HTMLMetaElement } */
        return dom.querySelector("meta[property='og:image']")?.content;
    }
}

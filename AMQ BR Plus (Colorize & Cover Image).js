// ==UserScript==
// @name         AMQ BR Plus (Colorize & Cover Image)
// @namespace    https://github.com/nekomeiji/AMQ-Script
// @version      1.9.6
// @description  Upgrade Battle Royal QOL (Safe Hook Edition)
// @description  Alt + O to open the window or when in game click on the icon in the top right.
// @description  ----- Main Page : -----
// @description  Display all the animes you picked.
// @description  The search bar filter the anime you picked.
// @description  Clicking on a Name will write it automatically into the answer box.
// @description  Clicking on an ANN ID will send you to the anime ANN Page.
// @description  Clicking on the "-" Next to the anime name will remove the anime from the picked list, and in picking phase will drop the anime.
// @description  Clicking on the Search icon on the right of the anime name will open an anisongdb search page for this anime.
// @description  ----- Tile List Page : -----
// @description  Clicking on Anime Name or ANN ID at the top Organize the Tile Animes.
// @description  Clicking on an Anime name, it will show you were it is in the Tile.
// @description  Clicking on an ANN ID will send you to the anime ANN Page.
// @description  The pages are resizable, and titles language adapt based on the one you have in settings.
// @author       Mxyuki (Original) + xTsuSaKu (Extender) + nekomeiji (Rewrite)
// @match        https://animemusicquiz.com/*
// @require      https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqWindows.js
// @require      https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqScriptInfo.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      cdn.animenewsnetwork.com
// @connect      s4.anilist.co
// @connect      media.kitsu.app
// ==/UserScript==

(function () {
    if (document.getElementById("loginPage")) return;

    let loadInterval = setInterval(() => {
        if (document.getElementById("loadingScreen").classList.contains("hidden")) {
            setup();
            clearInterval(loadInterval);
        }
    }, 500);

    let tileShow = [];
    let pickedShow = [];

    let isDisplayed = false;
    let language;
    let filteredAnimes = [];
    const regex = /^https:\/\/litter\.catbox\.moe\/.+\.json$/;

    let userAnimeListMap = {};
    let listDataLoaded = false;

    const LIST_COLORS = {
        1: "#4caf50", // Watching - Green
        2: "#2196f3", // Completed - Blue
        3: "#ffeb3b", // On-Hold - Yellow
        4: "#f44336", // Dropped - Red
        5: "#9e9e9e", // Planning - Grey
    };

    function getListColor(annId) {
        let status = userAnimeListMap[annId];
        return LIST_COLORS[status] || "";
    }

    function fetchAnimeList() {
        try {
            let handler = (typeof libraryCacheHandler !== "undefined") ? libraryCacheHandler : null;
            if (!handler && typeof unsafeWindow !== "undefined") handler = unsafeWindow.libraryCacheHandler;

            if (handler && typeof handler.getCache === "function") {
                handler.getCache(function () {
                    // After getCache completes, animeListMapCache is populated
                    userAnimeListMap = handler.animeListMapCache || {};
                    listDataLoaded = true;
                    console.log("[BRP] Anime list loaded, entries:", Object.keys(userAnimeListMap).length);
                    displayTile();
                });
            } else {
                console.warn("[BRP] libraryCacheHandler not found, retrying...");
            }
        } catch (e) {
            console.error("[BRP] fetchAnimeList error:", e);
        }
    }

    function buildNameIdMap() {
        let map = {};
        tileShow.forEach(t => {
            map[t.name] = t.id;
            let cleanName = t.name.replace("📦 ", "");
            if (cleanName !== t.name) map[cleanName] = t.id;
        });
        return map;
    }

    // --- Cover Fetching & Tooltip Setup ---
    const GM_CACHE_KEY = "amqGmCoverCache";
    const INFLIGHT = new Map();

    function extractCoverUrl(cacheEntry) {
        if (!cacheEntry) return null;
        let path = cacheEntry.url;
        if (path && path.includes("www.animenewsnetwork.com/images/encyc/")) {
            path = path.replace("www.animenewsnetwork.com/images/encyc/", "cdn.animenewsnetwork.com/thumbnails/fit200x200/encyc/");
        }
        if (cacheEntry.d) {
            const [prefix, dPath] = cacheEntry.d;
            const URL_PREFIXES = {
                A: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/",
                B: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/",
                C: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/",
                N: "https://cdn.animenewsnetwork.com/thumbnails/fit200x200/encyc/",
                K: "https://media.kitsu.app/anime/poster_images/",
                F: "",
            };
            path = URL_PREFIXES[prefix] + dPath;
            if (prefix === 'K') path = path.replace('large.jpg', 'small.jpg').replace('medium.jpg', 'small.jpg').replace('original.jpg', 'small.jpg');
        }
        return path;
    }

    async function preloadCoversBatched(annIds) {
        let coverCache = {};
        try { coverCache = JSON.parse(await GM_getValue(GM_CACHE_KEY, "{}")); } catch (e) { }

        let idsToFetch = [...new Set(annIds)].filter(id => {
            const key = String(id);
            if (coverCache[key] && Date.now() - coverCache[key].ts < 7 * 24 * 60 * 60 * 1000) return false;
            if (INFLIGHT.has(key)) return false;
            return true;
        });

        if (idsToFetch.length === 0) return;

        const BATCH_SIZE = 50;
        for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
            const batch = idsToFetch.slice(i, i + BATCH_SIZE);
            const batchString = batch.join('/');

            const promise = new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: `https://cdn.animenewsnetwork.com/encyclopedia/api.xml?title=${batchString}`,
                    timeout: 8000,
                    onload: async ({ responseText }) => {
                        let newCacheData = false;
                        let localCache = {};
                        try { localCache = JSON.parse(await GM_getValue(GM_CACHE_KEY, "{}")); } catch (e) { }

                        try {
                            const xml = new DOMParser().parseFromString(responseText, "text/xml");
                            const animes = xml.querySelectorAll("anime, manga");

                            animes.forEach(node => {
                                const id = String(node.getAttribute("id"));
                                const imgNode = [...node.querySelectorAll("info[type='Picture']")].pop();
                                let url = imgNode?.getAttribute("src") || null;
                                if (url?.includes("/encyc/")) {
                                    let dPath = url.split("/encyc/")[1] || url;
                                    localCache[id] = { d: ["N", dPath], ts: Date.now() };
                                    newCacheData = true;
                                } else if (url) {
                                    localCache[id] = { url, ts: Date.now() };
                                    newCacheData = true;
                                }
                                INFLIGHT.delete(id);
                            });

                            if (newCacheData) {
                                await GM_setValue(GM_CACHE_KEY, JSON.stringify(localCache));
                            }
                        } catch (e) { }

                        batch.forEach(id => INFLIGHT.delete(String(id)));
                        resolve();
                    },
                    onerror: () => { batch.forEach(id => INFLIGHT.delete(String(id))); resolve(); },
                    ontimeout: () => { batch.forEach(id => INFLIGHT.delete(String(id))); resolve(); }
                });
            });

            batch.forEach(id => INFLIGHT.set(String(id), promise));
        }
    }

    async function getCoverUrl(annId) {
        if (!annId) return null;
        const key = String(annId);

        let coverCache = {};
        try { coverCache = JSON.parse(await GM_getValue(GM_CACHE_KEY, "{}")); } catch (e) { }
        if (coverCache[key] && Date.now() - coverCache[key].ts < 7 * 24 * 60 * 60 * 1000) {
            return extractCoverUrl(coverCache[key]);
        }

        if (!INFLIGHT.has(key)) {
            await preloadCoversBatched([annId]);
        }

        if (INFLIGHT.has(key)) {
            await INFLIGHT.get(key);
        }

        try { coverCache = JSON.parse(await GM_getValue(GM_CACHE_KEY, "{}")); } catch (e) { }
        if (coverCache[key]) return extractCoverUrl(coverCache[key]);

        return null;
    }

    let coverTooltip;
    function initCoverTooltip() {
        if (document.getElementById("brp-cover-tooltip")) return;
        coverTooltip = document.createElement("div");
        coverTooltip.id = "brp-cover-tooltip";
        Object.assign(coverTooltip.style, {
            position: "fixed", display: "none", zIndex: "100000", pointerEvents: "none",
            background: "rgba(20, 20, 20, 0.95)", border: "1px solid #4fc3f7", borderRadius: "8px",
            padding: "10px", boxShadow: "0 4px 15px rgba(0,0,0,0.7)", color: "white",
            textAlign: "center", minWidth: "130px", maxWidth: "200px",
            transition: "opacity 0.15s ease-in-out", opacity: "0"
        });

        coverTooltip.innerHTML = `
            <div id="brp-tooltip-title" style="font-weight: bold; font-size: 14px; margin-bottom: 8px; word-wrap: break-word; line-height: 1.2;"></div>
            <img id="brp-tooltip-img" style="max-height: 200px; max-width: 140px; border-radius: 4px; display: none; margin: 0 auto;">
            <div id="brp-tooltip-loading" style="font-size: 12px; color: #aaa;">Loading...</div>
        `;
        document.body.appendChild(coverTooltip);
    }
    initCoverTooltip();

    let brpWindow;
    let brpTileListWindow;
    let brpAnisongdbWindow;

    const precisionCache = {};

    document.addEventListener('keydown', function (event) {
        if (event.altKey && event.code === 'KeyO') {
            if (brpWindow.isVisible()) {
                brpWindow.close();
            } else {
                brpWindow.open();
            }
        }
    });

    document.querySelector('#gcInput').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            processCommand(this.value);
        }
    });

    function displayList(listToDisplay) {
        const brpTable = document.getElementById('brpTable');
        brpTable.querySelectorAll('.brpPickedSong').forEach(el => el.remove());

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < listToDisplay.length; i++) {
            const tr = document.createElement('tr');
            tr.classList.add('brpPickedSong');
            let color = getListColor(listToDisplay[i].id);
            let nameColorStyle = color ? `style="color: ${color}; font-weight: bold;"` : "";
            let cellColorStyle = color ? `style="text-align: center; color: ${color}; font-weight: bold;"` : `style="text-align: center;"`;
            tr.innerHTML = `
                <td class="brpPickedName" ${nameColorStyle}>
                    <i class="fa fa-minus brpRemove" aria-hidden="true"></i>
                    <p data-annid="${listToDisplay[i].id}">${listToDisplay[i].name}</p>
                    <i class="fa fa-search brpAnisongSearch" aria-hidden="true"></i>
                </td>
                <td class="brpPickedPCS" ${cellColorStyle}>${listToDisplay[i].precision || ''}</td>
                <td class="brpPickedANNID" ${cellColorStyle}>${listToDisplay[i].id}</td>
            `;

            tr.querySelector('.brpRemove').addEventListener('click', function () {
                if (typeof socket !== 'undefined') {
                    socket.sendCommand({
                        type: "quiz",
                        command: "drop entry",
                        data: { id: listToDisplay[i].id }
                    });
                }
                const index = pickedShow.findIndex(s => s.name === listToDisplay[i].name);
                if (index !== -1) pickedShow.splice(index, 1);

                const filteredIndex = filteredAnimes.findIndex(s => s.name === listToDisplay[i].name);
                if (filteredIndex !== -1) filteredAnimes.splice(filteredIndex, 1);

                // Re-render
                let searchInput = document.getElementById("brpSearch");
                if (searchInput && searchInput.value) {
                    displayList(filteredAnimes);
                } else {
                    displayList(pickedShow);
                }
            });

            tr.querySelector('.brpAnisongSearch').addEventListener('click', function () {
                brpAnisongdbWindow.open();
                getAnisongdbData(listToDisplay[i].name);
            });

            tr.querySelector('p').addEventListener('click', function () {
                $("#qpAnswerInput").val(listToDisplay[i].name);
                if (typeof quiz !== 'undefined' && quiz.answerInput) {
                    quiz.answerInput.submitAnswer(true);
                }
            });

            tr.querySelector('.brpPickedANNID').addEventListener('click', function () {
                window.open(`https://www.animenewsnetwork.com/encyclopedia/anime.php?id=${listToDisplay[i].id}`, '_blank');
            });

            fragment.appendChild(tr);
        }
        brpTable.appendChild(fragment);
    }

    function displayPicked() {
        displayList(pickedShow);
    }

    function displayFiltered() {
        displayList(filteredAnimes);
    }

    function displayTile() {
        const brpTable = document.getElementById('brpTileListTable');
        if (!brpTable) return;
        brpTable.querySelectorAll('.brpTileSong').forEach(el => el.remove());

        // Group by name
        const groupedTiles = {};
        for (let i = 0; i < tileShow.length; i++) {
            let name = tileShow[i].name;
            if (!groupedTiles[name]) {
                groupedTiles[name] = { id: tileShow[i].id, name: name, count: 0 };
            }
            groupedTiles[name].count++;
        }

        // Sort alphabetically
        const sortedGroups = Object.values(groupedTiles).sort((a, b) => a.name.localeCompare(b.name));

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < sortedGroups.length; i++) {
            const tr = document.createElement('tr');
            tr.classList.add('brpTileSong');
            let displayName = sortedGroups[i].count > 1 ? `${sortedGroups[i].name} (x${sortedGroups[i].count})` : sortedGroups[i].name;
            let color = getListColor(sortedGroups[i].id);
            let nameStyle = color ? `style="color: ${color}; font-weight: bold;"` : "";
            let annStyle = color ? `style="text-align: center; color: ${color}; font-weight: bold;"` : `style="text-align: center;"`;
            tr.innerHTML = `<td class="brpTileName" ${nameStyle} data-annid="${sortedGroups[i].id}">${displayName}</td><td class="brpTileANNID" ${annStyle}>${sortedGroups[i].id}</td>`;

            tr.querySelector(".brpTileName").addEventListener("click", function () {
                findName(sortedGroups[i].name);
            });
            tr.querySelector(".brpTileANNID").addEventListener("click", function () {
                window.open(`https://www.animenewsnetwork.com/encyclopedia/anime.php?id=${sortedGroups[i].id}`);
            });
            fragment.appendChild(tr);
        }
        brpTable.appendChild(fragment);
    }

    function findName(name) {
        document.querySelectorAll('.brShowEntry.brMapObject').forEach((element) => {
            element.dispatchEvent(new MouseEvent('mouseover'));
        });

        setTimeout(() => {
            let popovers = document.getElementsByClassName('popover');
            let cleanName = name.replace("📦 ", "");
            let nameIdMap = buildNameIdMap();

            let matchedIds = [];
            for (let i = 0; i < popovers.length; i++) {
                if (popovers[i].textContent.includes(cleanName)) {
                    matchedIds.push(popovers[i].id);
                    // Color matching popovers
                    let text = (popovers[i].textContent || "").trim();
                    let pCleanText = text.replace(/^\d+\s*\|\s*/, '');
                    let annId = nameIdMap[text] || nameIdMap[pCleanText] || nameIdMap[cleanName];
                    if (annId) {
                        let color = getListColor(annId);
                        if (color) {
                            let contentDiv = popovers[i].querySelector('.popover-content');
                            if (contentDiv) {
                                contentDiv.style.color = color;
                                contentDiv.style.fontWeight = "bold";
                                contentDiv.style.textShadow = `0 0 6px ${color}`;
                            }
                        }
                    }
                }
            }

            let elements = document.getElementsByClassName('brMapObject');
            for (let j = 0; j < elements.length; j++) {
                let describedBy = elements[j].getAttribute('aria-describedby');
                if (!matchedIds.includes(describedBy)) {
                    elements[j].dispatchEvent(new MouseEvent('mouseout'));
                }
            }
        }, 100);
    }

    function hideName() {
        document.querySelectorAll('.brShowEntry.brMapObject').forEach((element) => {
            element.dispatchEvent(new MouseEvent('mouseout'));
        });
    }

    function showName() {
        document.querySelectorAll('.brShowEntry.brMapObject').forEach((element) => {
            element.dispatchEvent(new MouseEvent('mouseover'));
        });
    }

    function sendChatMessage(message) {
        if (typeof gameChat !== 'undefined') {
            gameChat.$chatInputField.val(message);
        }
    }

    function share() {
        if (pickedShow.length === 0) return;

        const file = new File([JSON.stringify(pickedShow)], "pickedShow.json", { type: "application/json" });
        const formData = new FormData();
        formData.append('fileToUpload', file);
        formData.append('reqtype', 'fileupload');
        formData.append('time', '1h');

        fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
            method: 'POST',
            body: formData
        }).then((response) => {
            return response.text();
        }).then((data) => {
            sendChatMessage(data);
        }).catch(err => {
            console.error("ESA: Failed to upload share file", err);
        });
    }

    function getArrayFromCatboxFile(link) {
        fetch(link)
            .then(response => response.json())
            .then(array => {
                for (let i = 0; i < array.length; i++) {
                    // Check for duplicates
                    if (!pickedShow.some(s => s.id === array[i].id)) {
                        pickedShow.push(array[i]);
                    }
                }
                displayPicked();
            })
            .catch(error => {
                console.error("Failed to retrieve array from Catbox file:", error);
            });
    }

    function processCommand(text) {
        if (text.startsWith("/brpload")) {
            document.querySelector('#gcInput').value = "";
            let link = text.split(" ")[1];
            if (regex.test(link)) {
                getArrayFromCatboxFile(link);
            }
        } else if (text.startsWith("/brpclean")) {
            document.querySelector('#gcInput').value = "";
            pickedShow = [];
            filteredAnimes = [];
            displayPicked();
        }
    }

    function toggleButton(showSelection) {
        if (showSelection === undefined) return;

        if (showSelection == 2 && $('#qpBRPlus').hasClass('hidden')) {
            let currentWidth = $("#qpOptionContainer").width();
            $("#qpOptionContainer").width(currentWidth + 35);
            $('#qpBRPlus').removeClass('hidden');
        } else if (showSelection != 2) {
            let currentWidth = $("#qpOptionContainer").width();
            $("#qpOptionContainer").width(currentWidth - 35);
            $('#qpBRPlus').addClass('hidden');
        }
    }

    function getAnisongdbData(query) {
        brpAnisongdbWindow.panels[0].clear();
        brpAnisongdbWindow.panels[0].panel.append(`<p>loading...</p>`);
        let json = {
            and_logic: false,
            ignore_duplicate: false,
            opening_filter: true,
            ending_filter: true,
            insert_filter: true,
            anime_search_filter: { search: query, partial_match: false }
        };

        fetch("https://anisongdb.com/api/search_request", {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(json)
        }).then(res => res.json()).then(json => {
            brpAnisongdbWindow.panels[0].clear();
            let $table = $(`
                <table id="brpAnisongdbTable" style="width: 95%; table-layout: fixed; margin: 0 auto; margin-top: 10px;">
                    <tr class="brptbfirstRow">
                        <th class="brpAnime" style="border: 1px solid black;">Anime</th>
                        <th class="brpArtist" style="border: 1px solid black;">Artist</th>
                        <th class="brpSong" style="border: 1px solid black;">Song</th>
                        <th class="brpType" style="border: 1px solid black;">Type</th>
                        <th class="brpVintage" style="border: 1px solid black;">Vintage</th>
                    </tr>
                </table>
            `);
            const useRomajiNames = (typeof options !== 'undefined' && options.useRomajiNames);
            for (let result of json) {
                let animeName = useRomajiNames ? result.animeJPName : result.animeENName;
                let $row = $(`
                    <tr>
                        <td class="brptbAnime">${animeName}</td>
                        <td class="brptbArtist">${result.songArtist}</td>
                        <td class="brptbSong">${result.songName}</td>
                        <td>${shortenType(result.songType)}</td>
                        <td>${result.animeVintage}</td>
                    </tr>
                `);
                $table.append($row);
            }
            brpAnisongdbWindow.panels[0].panel.append($table);
        }).catch(err => {
            brpAnisongdbWindow.panels[0].clear();
            brpAnisongdbWindow.panels[0].panel.append(`<p>Error loading data.</p>`);
        });
    }

    function shortenType(type) {
        return type.replace("Opening ", "OP").replace("Ending ", "ED").replace("Insert Song", "IN");
    }

    async function getPrecision(id) {
        if (!id) return "";
        if (precisionCache[id]) return precisionCache[id];
        try {
            const annData = await fetch("https://cdn.animenewsnetwork.com/encyclopedia/api.xml?anime=" + id).then(data => data.text());
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(annData, "text/xml");
            const precision = xmlDoc.querySelector("anime")?.getAttribute("precision") || "";
            precisionCache[id] = precision;
            return precision;
        } catch (e) {
            return "";
        }
    }

    function setup() {
        // Safe Hooking for Battle Royale Map
        let loadInterval2 = setInterval(() => {
            let brMap = (typeof window.BattleRoyalMap !== "undefined") ? window.BattleRoyalMap : ((typeof unsafeWindow !== "undefined") ? unsafeWindow.BattleRoyalMap : null);
            if (brMap && brMap.prototype.extractShowName) {
                console.log("ESA: Safe hooking BattleRoyalMap.prototype.extractShowName");
                const originalExtractShowName = brMap.prototype.extractShowName;
                brMap.prototype.extractShowName = function (nameInfo) {
                    const name = originalExtractShowName.call(this, nameInfo);
                    if (nameInfo.annId) return nameInfo.annId + " | " + name;
                    else if (nameInfo.id) return nameInfo.id + " | " + name;
                    return name;
                };
                clearInterval(loadInterval2);
            }
        }, 500);

        let showNameElem = document.querySelector('#smShowName');
        language = showNameElem ? showNameElem.value : 0;

        let oldWidth = $("#qpOptionContainer").width();
        $("#qpOptionContainer").width(oldWidth + 35);

        $("#qpOptionContainer > div").append(
            $(`<div id="qpBRPlus" class="clickAble qpOption"><i aria-hidden="true" class="fa fa-list-alt qpMenuItem" style="margin-right: 5px; width: 27px;"></i></div>`)
                .click(() => {
                    if (brpWindow.isVisible()) {
                        brpWindow.close();
                    } else {
                        brpWindow.open();
                    }
                })
                .popover({
                    content: "BR Plus",
                    trigger: "hover",
                    placement: "bottom"
                })
        );

        brpWindow = new AMQWindow({
            title: "BR Plus",
            width: 700,
            height: 450,
            minWidth: 440,
            minHeight: 250,
            zIndex: 999,
            draggable: true,
            resizable: true,
        });

        brpWindow.addPanel({ width: 1.0, height: 40, position: { x: 0, y: 20 }, id: "brpOption" });
        brpWindow.addPanel({ width: 1.0, height: "calc(100% - 75px)", position: { x: 0, y: 70 }, id: "brpPickedList" });

        brpWindow.panels[0].panel.append(
            $(`<input type="text" id="brpSearch" class="brpLeft brpTextBox brpOptionPanel" placeholder="Search Anime"></input>`),
            $(`<button class="btn btn-primary brpRight brpButton">Tile List</button>`).click(function () {
                if (brpTileListWindow.isVisible()) brpTileListWindow.close();
                else brpTileListWindow.open();
            }),
            $(`<button class="btn btn-primary brpRight brpButton">Share</button>`).click(function () {
                share();
            }),
            $(`<button class="btn btn-primary brpRight brpButton">Display</button>`).click(function () {
                isDisplayed = !isDisplayed;
                isDisplayed ? showName() : hideName();
            })
        );

        brpWindow.panels[1].panel.append(
            $(`
                <table id="brpTable">
                    <tr id="brpTableTop">
                        <th id="brpTableName">Anime Name</th>
                        <th id="brpTablePCS">Precision</th>
                        <th id="brpTableANN">ANN ID</th>
                    </tr>
                </table>
            `)
        );

        brpTileListWindow = new AMQWindow({
            title: "Tile List",
            width: 500,
            height: 350,
            minWidth: 440,
            minHeight: 250,
            zIndex: 1000,
            draggable: true,
            resizable: true,
        });

        brpTileListWindow.addPanel({ width: 1.0, height: "calc(100% - 25px)", position: { x: 0, y: 20 }, id: "brpTileList" });
        brpTileListWindow.panels[0].panel.append(
            $(`
                <table id="brpTileListTable">
                    <tr id="brpTileListTableTop">
                        <th id="brpTileListTableName">Anime Name</th>
                        <th id="brpTileListTableANN">ANN ID</th>
                    </tr>
                </table>
            `)
        );

        brpAnisongdbWindow = new AMQWindow({
            id: "brpAnisongdbWindow",
            title: "AnisongDB Search",
            width: 450,
            height: 250,
            minWidth: 450,
            minHeight: 250,
            zIndex: 1100,
            resizable: true,
            draggable: true
        });
        brpAnisongdbWindow.addPanel({ id: "brpAnisongdbPanel", width: 1.0, height: "100%", scrollable: { x: false, y: true } });

        document.getElementById("brpPickedList").style.overflow = "auto";
        document.getElementById("brpTileList").style.overflow = "auto";

        let searchInput = document.getElementById("brpSearch");
        searchInput.addEventListener("input", function () {
            let searchTerm = searchInput.value.toLowerCase();
            filteredAnimes = pickedShow.filter(function (anime) {
                return anime.name.toLowerCase().indexOf(searchTerm) !== -1;
            });
            if (searchTerm) {
                displayFiltered();
            } else {
                displayPicked();
            }
        });

        document.getElementById('brpTableName').addEventListener('click', function () {
            pickedShow.sort((a, b) => a.name.localeCompare(b.name));
            displayPicked();
        });

        document.getElementById('brpTableANN').addEventListener('click', function () {
            pickedShow.sort((a, b) => a.id - b.id);
            displayPicked();
        });

        document.getElementById('brpTileListTableName').addEventListener('click', function () {
            tileShow.sort((a, b) => a.name.localeCompare(b.name));
            displayTile();
        });

        document.getElementById('brpTileListTableANN').addEventListener('click', function () {
            tileShow.sort((a, b) => a.id - b.id);
            displayTile();
        });

        if (typeof AMQ_addStyle !== 'undefined') {
            AMQ_addStyle(`
                // Option Panel
                .brpButton { width: 75px; height: 40px; font-size: 15px; }
                .brpLeft { margin-left: 10px; }
                .brpRight { float: right; margin-right: 10px; background-color: #8d8cdd; border-color: #4d366a; }
                .brpRight:hover { background-color: #7C7CC1; border-color: #4d366a; box-shadow: none; }
                .brpOptionPanel { margin-top: 10px; }
                #brpSearch { color: #000; }
                // Picked Anime List
                #brpPickedList { width: 100%; height: 100px; position: absolute; left: 0%; top: 70px; overflow: scroll; }
                #brpTable { width: 95%; table-layout: fixed; margin: 0 auto; }
                #brpTable th { border: 1px solid black; text-align: center; background-color: #212121; color: white; }
                #brpTableName { width: 85%; margin-left: 10px; }
                #brpTablePCS { width: 15%; }
                #brpTableANN { width: 15%; }
                #brpPickedList::-webkit-scrollbar { width: 12px; background-color: rgba(0,0,0,0); }
                #brpPickedList::-webkit-scrollbar-thumb { background-color: #212121; border-radius: 12px; }
                .brpPickedSong:nth-child(even) { background-color: #313131; }
                .brpPickedName { padding-left: 10px; font-size: 15.23px; display: flex; align-items: center; justify-content: space-between; flex-direction: row; }
                .brpPickedName p { margin: 0; margin-right: auto; }
                .brpPickedANNID { font-size: 15.23px; }
                #brpTableName, #brpTableANN, #brpTablePCS { font-size: 16px; }
                #brpTableName:hover, #brpTableANN:hover { cursor: pointer; }
                .brpRemove { margin-right: 10px; margin-top: 3.5px; }
                .brpAnisongSearch { margin-left: 10px; margin-right: 10px; }
                // Tile List
                #brpTileList { width: 100%; height: 100px; position: absolute; left: 0%; top: 70px; overflow: scroll; }
                #brpTileListTable { width: 95%; table-layout: fixed; margin: 0 auto; }
                #brpTileListTable th { border: 1px solid black; text-align: center; background-color: #212121; color: white; }
                #brpTileListTableName { width: 85%; margin-left: 10px; }
                #brpTileListTableANN { width: 15%; }
                #brpTileList::-webkit-scrollbar { width: 12px; background-color: rgba(0,0,0,0); }
                #brpTileList::-webkit-scrollbar-thumb { background-color: #212121; border-radius: 12px; }
                .brpTileSong:nth-child(even) { background-color: #313131; }
                .brpTileName { padding-left: 10px; font-size: 15.23px; }
                .brpTileANNID { font-size: 15.23px; }
                #brpTileListTableName, #brpTileListTableANN { font-size: 16px; }
                #brpTileListTableName:hover, #brpTileListTableANN:hover, .brpTileSong:hover, .brpPickedName:hover, .brpPickedANNID:hover { cursor: pointer; }
                // Anisong Window
                #brpAnisongdbTable { width: 100%; }
                #brpAnisongdbTable th { font-weight: bold; }
                #brpAnisongdbTable th.brpAnime { width: 25%; }
                #barpAnisongdbTable th.brpArtist { width: 25%; }
                #brpAnisongdbTable th.brpSong { width: 25%; }
                #brpAnisongdbTable th.brpType { width: 10%; }
                #brpAnisongdbTable th.brpVintage { width: 15%; }
                #brpAnisongdbTable tr:nth-child(even) { background-color: #313131; }
                .brptbfirstRow { background-color: #212121; padding: 10px; }
                #brpAnisongdbPanel::-webkit-scrollbar { width: 12px; background-color: rgba(0,0,0,0); }
                #brpAnisongdbPanel::-webkit-scrollbar-thumb { background-color: #212121; border-radius: 12px; }
            `);
        }

        if (typeof Listener !== 'undefined') {
            new Listener("new collected name entry", async (payload) => {
                let precision = await getPrecision(payload.id);
                let addedName = (language == 0 && payload.eng) ? payload.eng : payload.jap;
                if (!addedName && payload.eng) addedName = payload.eng; // Fallback

                pickedShow.push({ id: payload.id, name: addedName, precision });

                let searchInput = document.getElementById("brpSearch");
                if (searchInput && searchInput.value) {
                    let searchTerm = searchInput.value.toLowerCase();
                    if (addedName.toLowerCase().includes(searchTerm)) {
                        filteredAnimes.push({ id: payload.id, name: addedName, precision });
                        displayFiltered();
                    }
                } else {
                    displayPicked();
                }
            }).bindListener();

            new Listener("drop name entry", (payload) => {
                pickedShow = pickedShow.filter(anime => anime.id !== payload.id);
                filteredAnimes = filteredAnimes.filter(anime => anime.id !== payload.id);
                let searchInput = document.getElementById("brpSearch");
                if (searchInput && searchInput.value) displayFiltered();
                else displayPicked();
            }).bindListener();

            new Listener("Game Starting", () => {
                pickedShow = [];
                filteredAnimes = [];
                displayPicked();
            }).bindListener();

            new Listener("battle royal spawn", (payload) => {
                tileShow = [];
                setTimeout(() => { isDisplayed ? showName() : hideName(); }, 100);

                let batchIds = [];
                payload.objects.forEach((object) => {
                    if (object.info.type == "NameEntry") {
                        let addedName = (language == 0 && object.info.eng) ? object.info.eng : object.info.jap;
                        if (!addedName && object.info.eng) addedName = object.info.eng;
                        let annId = object.info.annId || object.info.id;
                        tileShow.push({ id: annId, name: addedName, x: object.x, y: object.y });
                        batchIds.push(annId);
                    }
                });

                if (batchIds.length > 0) preloadCoversBatched(batchIds);

                if (!listDataLoaded) {
                    fetchAnimeList();
                } else {
                    displayTile();
                }
                setTimeout(() => { colorFloorIcons(); }, 500);
            }).bindListener();

            new Listener("battle royal object despawn", (payload) => {
                tileShow = tileShow.filter(anime => !(anime.x === payload.x && anime.y === payload.y));
                displayTile();
            }).bindListener();

            new Listener("battle royal data store content", (payload) => {
                let batchIds = [];
                payload.entries.forEach(entry => {
                    let addedName = (language == 0 && entry.eng) ? entry.eng : entry.jap;
                    if (!addedName && entry.eng) addedName = entry.eng;
                    if (!tileShow.some(s => s.id === entry.id)) {
                        tileShow.push({ id: entry.id, name: "📦 " + addedName });
                        batchIds.push(entry.id);
                    }
                });

                if (batchIds.length > 0) preloadCoversBatched(batchIds);
                displayTile();
            }).bindListener();

            new Listener("container entry despawn", (payload) => {
                // Remove datastore item when picked up
                tileShow = tileShow.filter(anime => anime.id !== payload.id);
                displayTile();
            }).bindListener();

            // Fetch anime list data on startup and on each BR round
            let fetchInterval = setInterval(() => {
                let handler = (typeof libraryCacheHandler !== "undefined") ? libraryCacheHandler : null;
                if (!handler && typeof unsafeWindow !== "undefined") handler = unsafeWindow.libraryCacheHandler;
                if (handler) {
                    fetchAnimeList();
                    clearInterval(fetchInterval);
                }
            }, 2000);

            new Listener("Host Game", (payload) => { setTimeout(() => { toggleButton(payload.settings.showSelection); }, 100); }).bindListener();
            // Bug Fix 2: payload.showSelection -> payload.changes.showSelection
            new Listener("Room Settings Changed", (payload) => { setTimeout(() => { toggleButton(payload.changes ? payload.changes.showSelection : undefined); }, 100); }).bindListener();
            new Listener("Join Game", (payload) => { setTimeout(() => { toggleButton(payload.settings.showSelection); }, 100); }).bindListener();
            new Listener("Spectate Game", (payload) => { setTimeout(() => { toggleButton(payload.settings.showSelection); }, 100); }).bindListener();
        }

        // === Item 3: Color floor icons after spawn ===
        function colorFloorIcons() {
            let nameIdMap = buildNameIdMap();
            let elements = document.querySelectorAll('.brShowEntry.brMapObject');
            if (elements.length === 0) return;

            // Briefly trigger all popovers to read their content
            elements.forEach(el => el.dispatchEvent(new MouseEvent('mouseover')));

            setTimeout(() => {
                elements.forEach(el => {
                    let popoverId = el.getAttribute('aria-describedby');
                    if (!popoverId) return;
                    let popover = document.getElementById(popoverId);
                    if (!popover) return;

                    let text = (popover.textContent || "").trim();
                    // Strip "ID | " prefix if hook added it
                    let cleanText = text.replace(/^\d+\s*\|\s*/, '');
                    let annId = nameIdMap[text] || nameIdMap[cleanText];

                    if (annId) {
                        let color = getListColor(annId);
                        if (color) {
                            // Color the floor icon
                            el.style.filter = `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 8px ${color})`;
                            // Also color the popover text
                            let contentDiv = popover.querySelector('.popover-content');
                            if (contentDiv) {
                                contentDiv.style.color = color;
                                contentDiv.style.fontWeight = "bold";
                                contentDiv.style.textShadow = `0 0 6px ${color}`;
                            }
                        }
                    }
                });
                // Restore Display state: if Display was on, keep popovers visible; otherwise hide
                if (!isDisplayed) {
                    elements.forEach(el => el.dispatchEvent(new MouseEvent('mouseout')));
                }
            }, 200);
        }

        // === Item 4: Live popover coloring & Hover Preview Tooltip ===
        let hoverTimeout;
        let currentHoveredAnnId = null;

        document.addEventListener('mouseover', function (e) {
            let target = e.target.closest('.brShowEntry, li[class^="brContainerEntry-"], .brpPickedName p, .brpTileName');
            if (!target) return;

            if (target.classList.contains('brMapObject')) {
                setTimeout(() => {
                    let popoverId = target.getAttribute('aria-describedby');
                    if (popoverId) {
                        let popover = document.getElementById(popoverId);
                        if (popover) {
                            let contentDiv = popover.querySelector('.popover-content');
                            if (contentDiv) {
                                let text = (contentDiv.textContent || "").trim();
                                let cleanText = text.replace(/^\d+\s*\|\s*/, '');
                                let nameIdMap = buildNameIdMap();
                                let annId = nameIdMap[text] || nameIdMap[cleanText];
                                if (annId) {
                                    let color = getListColor(annId);
                                    if (color) {
                                        contentDiv.style.color = color;
                                        contentDiv.style.fontWeight = "bold";
                                        contentDiv.style.textShadow = `0 0 6px ${color}`;
                                    }
                                }
                            }
                        }
                    }
                }, 50);
            }

            if (!e.isTrusted) return;

            let annId = null;
            let title = "";
            let nameIdMap = buildNameIdMap();
            let unifiedMap = { ...nameIdMap };
            pickedShow.forEach(p => { unifiedMap[p.name] = p.id; unifiedMap[p.name.replace("📦 ", "")] = p.id; });

            if (target.classList.contains('brShowEntry')) {
                try {
                    let popoverData = $(target).data('bs.popover');
                    if (popoverData) title = typeof popoverData.options.content === 'function' ? popoverData.options.content() : popoverData.options.content;
                } catch (e) { }
            } else if (target.tagName === 'LI' && target.className.match(/brContainerEntry-(\d+)/)) {
                annId = parseInt(target.className.match(/brContainerEntry-(\d+)/)[1]);
                title = target.textContent;
            } else if (target.hasAttribute('data-annid')) {
                annId = parseInt(target.getAttribute('data-annid'));
                title = target.textContent;
            }

            if (title) {
                let cleanText = title.replace(/^\d+\s*\|\s*/, '');
                let match = title.match(/^(\d+)\s*\|/);
                if (!annId && match) annId = parseInt(match[1]);
                if (!annId) annId = unifiedMap[title.trim()] || unifiedMap[cleanText.trim()];
            }

            if (annId) {
                currentHoveredAnnId = annId;
                clearTimeout(hoverTimeout);

                hoverTimeout = setTimeout(() => {
                    let displayTitle = (title || "").replace(/^\d+\s*\|\s*/, '');
                    document.getElementById('brp-tooltip-title').textContent = displayTitle;

                    let img = document.getElementById('brp-tooltip-img');
                    let loader = document.getElementById('brp-tooltip-loading');
                    img.style.display = 'none';
                    img.src = "";
                    loader.style.display = 'block';
                    loader.textContent = "Loading...";

                    let color = getListColor(annId);
                    let titleEl = document.getElementById('brp-tooltip-title');
                    if (color) {
                        titleEl.style.color = color;
                        titleEl.style.textShadow = `0 0 6px ${color}`;
                    } else {
                        titleEl.style.color = "white";
                        titleEl.style.textShadow = "none";
                    }

                    coverTooltip.style.display = 'block';
                    requestAnimationFrame(() => coverTooltip.style.opacity = '1');

                    let w = coverTooltip.offsetWidth;
                    let h = coverTooltip.offsetHeight;
                    let x = e.clientX + 15;
                    let y = e.clientY + 15;
                    if (x + w > window.innerWidth) x = e.clientX - w - 15;
                    if (y + h > window.innerHeight) y = window.innerHeight - h - 10;
                    coverTooltip.style.left = x + 'px';
                    coverTooltip.style.top = y + 'px';

                    getCoverUrl(annId).then(url => {
                        if (currentHoveredAnnId === annId && coverTooltip.style.display !== "none") {
                            if (url) {
                                img.src = url;
                                img.onload = () => { img.style.display = 'block'; loader.style.display = 'none'; };
                            } else {
                                loader.textContent = "No Cover Found";
                            }
                        }
                    });
                }, 100);
            }
        }, true);

        document.addEventListener('mouseout', function (e) {
            let target = e.target.closest('.brShowEntry, li[class^="brContainerEntry-"], .brpPickedName p, .brpTileName');
            if (target && e.isTrusted) {
                clearTimeout(hoverTimeout);
                currentHoveredAnnId = null;
                coverTooltip.style.opacity = '0';
                setTimeout(() => { if (coverTooltip.style.opacity === '0') coverTooltip.style.display = 'none'; }, 150);
            }
        }, true);

        document.addEventListener('mousemove', function (e) {
            if (currentHoveredAnnId && coverTooltip.style.display !== "none") {
                let w = coverTooltip.offsetWidth;
                let h = coverTooltip.offsetHeight;
                let x = e.clientX + 15;
                let y = e.clientY + 15;
                if (x + w > window.innerWidth) x = e.clientX - w - 15;
                if (y + h > window.innerHeight) y = window.innerHeight - h - 10;
                coverTooltip.style.left = x + 'px';
                coverTooltip.style.top = y + 'px';
            }
        }, true);

        // Also observe #brMapContainer subtree for datastore entry LIs
        const datastoreObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;
                    let lis = node.tagName === 'LI' ? [node] : node.querySelectorAll('li[class^="brContainerEntry-"]');
                    let nameIdMap = buildNameIdMap();
                    lis.forEach(li => {
                        let text = (li.textContent || "").trim();
                        // Try ID prefix first, then name lookup
                        let match = text.match(/^(\d+)\s*\|/);
                        let annId = match ? parseInt(match[1]) : null;
                        if (!annId) {
                            let cleanText = text.replace(/^\d+\s*\|\s*/, '');
                            annId = nameIdMap[text] || nameIdMap[cleanText];
                        }
                        if (annId) {
                            let color = getListColor(annId);
                            if (color) {
                                li.style.color = color;
                                li.style.fontWeight = "bold";
                            }
                        }
                    });
                });
            });
        });

        let brMapInterval = setInterval(() => {
            let container = document.getElementById('brMapContainer');
            if (container) {
                datastoreObserver.observe(container, { childList: true, subtree: true });
                clearInterval(brMapInterval);
            }
        }, 1000);
    }
})();
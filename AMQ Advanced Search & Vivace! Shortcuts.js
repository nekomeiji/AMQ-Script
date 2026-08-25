// ==UserScript==
// @name         AMQ Advanced Search & Vivace! Shortcuts
// @namespace    https://github.com/nekomeiji/AMQ-Script
// @version      1.7.5
// @description  Replaces the single Song Library search box with 3 dedicated fields. Includes Native Library Shortcuts (Vivace engine merged).
// @author       nekomeiji
// @match        https://animemusicquiz.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/*jshint esversion: 8 */

(function () {
    "use strict";

    const SCRIPT_NAME = "AMQ Advanced Search";
    const VERSION = "1.7.5";
    const SHORT_QUERY_THRESHOLD = 4;

    // =========================================================================
    // 1. VIVACE ENGINE CONFIG (Merged for Library Use)
    // =========================================================================
    const MAX_DROPDOWN_ITEMS = 25;
    const MAX_SUBSTRING_LENGTH = 10;
    const NUM_SHORTCUTS = 10;
    const MAX_LENGTH_DIFFERENTIAL = 3;
    const FULL_SHORTCUTS = false;
    const TOP_SHORTCUTS_ONLY = false;
    const ACTIVE_KEYBOARD_LAYOUT = "qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM1234567890`~!@#$%^&*()-_=+[{]}\\|;:'\",<.>/? ";
    const NORMALIZATION_MAP = { ō: "o", ó: "o", ò: "o", ö: "o", ô: "o", ø: "o", Φ: "o", ū: "u", û: "u", ú: "u", ù: "u", ü: "u", ǖ: "u", ä: "a", â: "a", à: "a", á: "a", ạ: "a", å: "a", æ: "a", ā: "a", č: "c", "★": " ", "☆": " ", "/": " ", "*": " ", "=": " ", "+": " ", "·": " ", "♥": " ", "∽": " ", "・": " ", "〜": " ", "†": " ", "×": "x", "♪": " ", "→": " ", "␣": " ", ":": " ", ";": " ", "~": " ", "-": " ", "?": " ", ",": " ", ".": " ", "!": " ", "@": " ", _: " ", "#": " ", "'": " ", é: "e", ê: "e", ë: "e", è: "e", ē: "e", ñ: "n", "²": "", í: "i", "³": "", ß: "b" };
    const ALLOWED_SPECIAL_CHARACTERS = ["/", "*", "=", "+", ":", ";", "-", "?", ",", ".", "!", "@", "_", "#", "'"];
    const DISALLOWED_SPECIAL_CHARACTERS = ["∞", "△", "↓", "°", "♡", "∬"];

    let libraryNamesList = [];

    // =========================================================================
    // 2. WAIT FOR GAME TO LOAD
    // =========================================================================
    function waitForGameReady() {
        return new Promise((resolve) => {
            let checker = setInterval(() => {
                if (
                    typeof LibraryFilterApplier !== "undefined" &&
                    typeof LibraryFilter !== "undefined" &&
                    document.querySelector(".elFilterSearchContainer")
                ) {
                    clearInterval(checker);
                    resolve();
                }
            }, 300);
        });
    }

    // =========================================================================
    // 3. INJECT CSS
    // =========================================================================
    function injectStyles() {
        if (document.getElementById("sayu-adv-search-css")) return;
        const css = document.createElement("style");
        css.id = "sayu-adv-search-css";
        css.textContent = `
            .elFilterSearchContainer.sayu-hidden-original { display: none !important; }
            .sayuSearchFieldsContainer { padding: 8px 10px 10px 10px; background-color: #1b1b1bd6; box-sizing: border-box; border-radius: 4px; box-shadow: 0 0 10px 2px rgb(0, 0, 0); margin-bottom: 5px; }
            .sayuSearchFieldsTitleContainer { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
            .sayuSearchFieldsTitle { font-size: 15px; font-weight: bold; color: #28a4ff; letter-spacing: 0.5px; margin: 0; }

            /* Custom Strict Pill Button */
            .sayuCustomStrictBtn { display: flex; align-items: center; justify-content: center; height: 24px; width: 90px; background-color: #333; border-radius: 12px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 0 3px rgba(0,0,0,0.5); font-size: 12px; color: #aaa; font-weight: bold; letter-spacing: 1px; user-select: none; }
            .sayuCustomStrictBtn:hover { background-color: #444; }
            .sayuCustomStrictBtn.active { background-color: #006ab7; color: #fff; }
            .sayuCustomStrictBtn.active:hover { background-color: #28a4ff; }

            .sayuSearchFieldGroup { position: relative; margin-bottom: 5px; }
            .sayuSearchFieldGroup:last-child { margin-bottom: 0; }
            .sayuSearchInput { width: 100%; height: 28px; background-color: #1b1b1b; border: 1px solid #444; border-radius: 3px; font-size: 14px; color: #ddd; outline: none; padding: 2px 24px 2px 10px; box-sizing: border-box; font-family: inherit; transition: border-color 0.15s ease; }
            .sayuSearchInput:focus { border-color: #28a4ff; }
            .sayuSearchInput::placeholder { color: #777; font-style: italic; }
            .sayuClearBtn { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; line-height: 18px; text-align: center; font-size: 12px; color: #777; cursor: pointer; border-radius: 50%; background: transparent; transition: color 0.1s ease, background-color 0.1s ease; display: none; }
            .sayuClearBtn:hover { color: #fff; background-color: #555; }
            .sayuSearchFieldGroup.has-value .sayuClearBtn { display: block; }
        `;
        document.head.appendChild(css);
    }

    // =========================================================================
    // 4. BUILD NEW UI
    // =========================================================================
    function buildSearchUI() {
        const origContainers = document.querySelectorAll(".elFilterSearchContainer");
        if (origContainers.length === 0) return null;

        document.querySelectorAll(".sayuSearchFieldsContainer").forEach((el) => el.remove());
        const uiElements = { $anime: $(), $song: $(), $artist: $() };

        origContainers.forEach((targetContainer) => {
            const strictToggle = targetContainer.querySelector(".elFilterStrictToggle");
            targetContainer.classList.add("sayu-hidden-original");

            const container = document.createElement("div");
            container.className = "sayuSearchFieldsContainer";
            container.innerHTML = `
                <div class="sayuSearchFieldsTitleContainer">
                    <label class="sayuSearchFieldsTitle">Advanced Search</label>
                    <div class="sayuCustomStrictBtn">STRICT</div>
                </div>
                <div class="sayuSearchFieldGroup" data-field="anime">
                    <input type="text" class="sayuSearchInput sayuSearchAnime" placeholder="Search by anime..." autocomplete="off" />
                    <span class="sayuClearBtn" title="Clear">✕</span>
                </div>
                <div class="sayuSearchFieldGroup" data-field="song">
                    <input type="text" class="sayuSearchInput sayuSearchSong" placeholder="Search by song name..." autocomplete="off" />
                    <span class="sayuClearBtn" title="Clear">✕</span>
                </div>
                <div class="sayuSearchFieldGroup" data-field="artist">
                    <input type="text" class="sayuSearchInput sayuSearchArtist" placeholder="Search by artist..." autocomplete="off" />
                    <span class="sayuClearBtn" title="Clear">✕</span>
                </div>
            `;
            targetContainer.parentNode.insertBefore(container, targetContainer);

            // Proxy the Strict Button
            if (strictToggle) {
                strictToggle.style.display = "none";
                container.appendChild(strictToggle); // Keep it in DOM for AMQ to find

                const customStrictBtn = container.querySelector(".sayuCustomStrictBtn");

                customStrictBtn.addEventListener("click", () => {
                    strictToggle.click();
                });

                const observer = new MutationObserver(() => {
                    if (strictToggle.classList.contains("active")) {
                        customStrictBtn.classList.add("active");
                    } else {
                        customStrictBtn.classList.remove("active");
                    }
                });
                observer.observe(strictToggle, { attributes: true, attributeFilter: ["class"] });

                if (strictToggle.classList.contains("active")) customStrictBtn.classList.add("active");
            }

            uiElements.$anime = uiElements.$anime.add($(container).find(".sayuSearchAnime"));
            uiElements.$song = uiElements.$song.add($(container).find(".sayuSearchSong"));
            uiElements.$artist = uiElements.$artist.add($(container).find(".sayuSearchArtist"));

            container.querySelectorAll(".sayuSearchFieldGroup").forEach((group) => {
                const searchInput = group.querySelector(".sayuSearchInput");
                const clearBtn = group.querySelector(".sayuClearBtn");
                clearBtn.addEventListener("click", () => {
                    const fieldClass = searchInput.classList.contains("sayuSearchAnime") ? ".sayuSearchAnime" : searchInput.classList.contains("sayuSearchSong") ? ".sayuSearchSong" : ".sayuSearchArtist";
                    $(fieldClass).val("").each(function () { this.closest(".sayuSearchFieldGroup").classList.remove("has-value"); });
                    searchInput.focus();
                    $(searchInput).trigger("input");
                });
            });
        });

        const bindSync = ($jqCollection) => {
            $jqCollection.on("input", function () {
                const val = this.value;
                $jqCollection.val(val).each(function () { this.closest(".sayuSearchFieldGroup").classList.toggle("has-value", val.length > 0); });
            });
        };
        bindSync(uiElements.$anime);
        bindSync(uiElements.$song);
        bindSync(uiElements.$artist);

        return uiElements;
    }

    // =========================================================================
    // 5. SEARCH MATCHING UTILITIES
    // =========================================================================
    function escapeRegExpLocal(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    function normalizeQuery(str) {
        let lower = str.toLowerCase();
        if (typeof replaceCharactersForSeachCharacters === "function") return replaceCharactersForSeachCharacters(lower);
        return lower;
    }
    function parseQuery(q) {
        q = q.trim();
        if (!q) return { raw: "", tokens: [], isExact: false };
        if (q.length >= 2 && q.startsWith('"') && q.endsWith('"')) {
            let inner = normalizeQuery(q.slice(1, -1).trim());
            return { raw: inner, tokens: [inner], isExact: true };
        }
        let lower = q.toLowerCase();
        let normalized = normalizeQuery(lower);
        let tokens = normalized.split(/\s+/).filter(Boolean);
        return { raw: normalized, rawLower: lower, tokens: tokens, isExact: false };
    }
    function scoreMatch(name, parsed) {
        if (!name || !parsed.raw) return 0;
        let nameLower = name.toLowerCase();
        if (nameLower === parsed.raw || (parsed.rawLower && nameLower === parsed.rawLower)) return 100;
        if (parsed.isExact) return 0;
        const wbRegex = new RegExp(`(^|[\\s\\-_/・★☆+×♪~:;,.!@#])` + escapeRegExpLocal(parsed.raw) + `([\\s\\-_/・★☆+×♪~:;,.!@#]|$)`, "i");
        if (wbRegex.test(nameLower)) return 80;
        if (nameLower.startsWith(parsed.raw)) return 50;
        if (parsed.raw.length <= SHORT_QUERY_THRESHOLD) return 0;
        if (parsed.tokens.length > 1) {
            let allTokensMatch = parsed.tokens.every((token) => nameLower.includes(token));
            if (allTokensMatch) return 35;
        }
        if (nameLower.includes(parsed.raw)) return 20;
        return 0;
    }
    function scoreEntry(target, parsed) {
        if (!parsed || !parsed.raw) return 100;
        let bestScore = 0;
        let namesToSearch = [];

        if (target.animeEntry && target.animeEntry.names) {
            namesToSearch = target.animeEntry.names.map(n => n.name);
        } else if (target.songEntry && target.songEntry.name) {
            namesToSearch = [target.songEntry.name];
        } else if (target.name) {
            namesToSearch = [target.name];
        } else if (typeof target === "string") {
            namesToSearch = [target];
        }

        for (let i = 0; i < namesToSearch.length; i++) {
            let s = scoreMatch(namesToSearch[i], parsed);
            if (s > bestScore) bestScore = s;
            if (bestScore >= 100) break;
        }
        return bestScore;
    }
    function scoreArtistEntry(artistEntry, parsed, isStrict) {
        if (!artistEntry) return 0;
        let directScore = scoreEntry(artistEntry, parsed);
        if (directScore > 0 || isStrict) return directScore;
        if (typeof artistEntry.getFullMemberEntryList === "function") {
            let members = artistEntry.getFullMemberEntryList();
            for (let i = 0; i < members.length; i++) {
                let s = scoreEntry(members[i], parsed);
                if (s > directScore) directScore = s;
                if (directScore >= 80) break;
            }
        }
        return directScore;
    }

    // =========================================================================
    // 6. MONKEY-PATCH THE FILTER APPLIER
    // =========================================================================
    function patchFilterApplier(uiElements) {
        // Hook 1: Catch library initialization to populate Vivace dictionary
        const origUpdateBaseEntryList = LibraryFilterApplier.prototype.updateBaseEntryList;
        LibraryFilterApplier.prototype.updateBaseEntryList = function (newList, sortByField, accendingOrder) {
            origUpdateBaseEntryList.call(this, newList, sortByField, accendingOrder);
            let namesSet = new Set();
            newList.forEach(entry => {
                if (entry.animeEntry && entry.animeEntry.names) {
                    entry.animeEntry.names.forEach(n => namesSet.add(n.name));
                }
            });
            libraryNamesList = Array.from(namesSet);
        };

        // Hook 2: The actual search intercept
        const origApplySearchFilter = LibraryFilterApplier.prototype.applySearchFilter;
        LibraryFilterApplier.prototype.applySearchFilter = function () {
            // Fallback: Populate Vivace dictionary if missed by updateBaseEntryList
            if (libraryNamesList.length === 0 && this.firstPassEntries) {
                let namesSet = new Set();
                this.firstPassEntries.forEach(entry => {
                    if (entry.animeEntry && entry.animeEntry.names) {
                        entry.animeEntry.names.forEach(n => namesSet.add(n.name));
                    }
                });
                libraryNamesList = Array.from(namesSet);
            }

            const qAnimeRaw = uiElements.$anime.first().val();
            const qSongRaw = uiElements.$song.first().val();
            const qArtistRaw = uiElements.$artist.first().val();

            if (!qAnimeRaw && !qSongRaw && !qArtistRaw) {
                if (this.currentFilter && this.currentFilter.searchQuery) {
                    origApplySearchFilter.call(this);
                    return;
                }
                this.secondPassEntries = [...this.firstPassEntries];
                this.secondPassEntries.forEach((entry) => { entry.searchFilterSongs = entry.filterSongs; });
                return;
            }

            const pAnime = parseQuery(qAnimeRaw);
            const pSong = parseQuery(qSongRaw);
            const pArtist = parseQuery(qArtistRaw);
            const isStrict = Boolean(this.currentFilter && this.currentFilter.strictSearch);

            this.secondPassEntries = [...this.firstPassEntries];
            let scoredEntries = [];

            this.secondPassEntries.forEach((entry) => {
                let animeScore = pAnime.raw ? scoreEntry(entry, pAnime) : 100;
                if (animeScore === 0) return;
                let matchedSongs = [];
                let bestSongComboScore = 0;

                entry.filterSongs.forEach((songWrapper) => {
                    const songEntry = songWrapper.songEntry;
                    if (!songEntry) return;
                    let songScore = pSong.raw ? scoreEntry(songEntry, pSong) : 100;
                    if (songScore === 0) return;
                    let artistScore = 100;
                    if (pArtist.raw) {
                        artistScore = 0;
                        if (songEntry.artist) artistScore = scoreArtistEntry(songEntry.artist, pArtist, isStrict);
                        if (artistScore === 0 && songEntry.composer) artistScore = scoreArtistEntry(songEntry.composer, pArtist, isStrict);
                        if (artistScore === 0 && songEntry.arranger) artistScore = scoreArtistEntry(songEntry.arranger, pArtist, isStrict);
                        if (artistScore === 0) return;
                    }
                    matchedSongs.push(songWrapper);
                    let comboScore = animeScore + songScore + artistScore;
                    if (comboScore > bestSongComboScore) bestSongComboScore = comboScore;
                });

                if (matchedSongs.length > 0) {
                    entry.searchFilterSongs = matchedSongs;
                    scoredEntries.push({ entry: entry, score: bestSongComboScore });
                }
            });

            scoredEntries.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                let nameA = a.entry.mainName || a.entry.animeEntry?.mainName || a.entry.songEntry?.name || "";
                let nameB = b.entry.mainName || b.entry.animeEntry?.mainName || b.entry.songEntry?.name || "";
                return nameA.localeCompare(nameB);
            });
            this.secondPassEntries = scoredEntries.map((s) => s.entry);
        };
    }

    // =========================================================================
    // 7. HOOK INPUT EVENTS & RESET
    // =========================================================================
    function hookInputEvents(uiElements) {
        let debounceTimer = null;
        const triggerSearch = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => { $(".elFilterSearchInput").trigger("input"); }, 100);
        };
        uiElements.$anime.on("input", triggerSearch);
        uiElements.$song.on("input", triggerSearch);
        uiElements.$artist.on("input", triggerSearch);
    }
    function patchReset(uiElements) {
        const origReset = LibraryFilter.prototype.reset;
        LibraryFilter.prototype.reset = function () {
            origReset.call(this);
            uiElements.$anime.val(""); uiElements.$song.val(""); uiElements.$artist.val("");
            document.querySelectorAll(".sayuSearchFieldGroup").forEach((g) => g.classList.remove("has-value"));
        };
    }
    function patchUpdateSearch(uiElements) {
        LibraryFilter.prototype.updateSearch = function (searchQuery) {
            this.$searchInput.val("");
            uiElements.$anime.val(searchQuery); uiElements.$song.val(""); uiElements.$artist.val("");
            document.querySelectorAll(".sayuSearchFieldGroup").forEach((g) => {
                let input = g.querySelector(".sayuSearchInput");
                g.classList.toggle("has-value", input && input.value.length > 0);
            });
            uiElements.$anime.first().trigger("input");
        };
    }

    // =========================================================================
    // 8. VIVACE NATIVE ENGINE (MERGED)
    // =========================================================================
    const getSuggestions = (search) => {
        if (typeof createAnimeSearchRegexQuery !== "function") return [];
        const regex = new RegExp(createAnimeSearchRegexQuery(search), "i");
        const filteredList = libraryNamesList.filter(anime => regex.test(anime));
        filteredList.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
        return filteredList.slice(0, MAX_DROPDOWN_ITEMS);
    };

    const getAllSubstrings = (str) => {
        const result = [];
        for (let i = 0; i < str.length; i++) {
            for (let j = i + 1; j < str.length + 1; j++) {
                result.push(str.slice(i, j));
            }
        }
        return result;
    };

    const mapToAlternativeSubstrings = (substring) => {
        const alternatives = new Set();
        if (typeof replaceCharactersForSeachCharacters !== "function") return [substring];

        alternatives.add(replaceCharactersForSeachCharacters(substring).replace(new RegExp(`[^${ACTIVE_KEYBOARD_LAYOUT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]`, "gu"), ""));

        let normalized = substring.replace(/./g, (char) => {
            if (!ACTIVE_KEYBOARD_LAYOUT.includes(char)) return "";
            if (ALLOWED_SPECIAL_CHARACTERS.includes(char)) return char;
            return NORMALIZATION_MAP[char] || char;
        });
        alternatives.add(normalized);
        alternatives.add(normalized.replace(/oo/g, "o")).add(normalized.replace(/ou/g, "o")).add(normalized.replace(/uu/g, "u"));

        let specialCharIndexes = Array.from(substring).map((char, index) => ALLOWED_SPECIAL_CHARACTERS.includes(char) ? index : -1).filter((index) => index !== -1);
        if (specialCharIndexes.length > 3) specialCharIndexes = specialCharIndexes.slice(0, 3);

        for (let i = 0; i < 1 << specialCharIndexes.length; i++) {
            let current = normalized;
            for (let j = 0; j < specialCharIndexes.length; j++) {
                if (i & (1 << j)) {
                    current = current.substring(0, specialCharIndexes[j]) + " " + current.substring(specialCharIndexes[j] + 1);
                }
            }
            alternatives.add(current);
            while (current.includes("  ")) {
                current = current.replace("  ", " ");
                alternatives.add(current);
            }
        }
        return Array.from(alternatives);
    };

    const supersequenceQ = (str1, str2) => {
        if (str1.length < str2.length) return false;
        let i = 0, j = 0;
        while (i < str1.length && j < str2.length) {
            if (str1[i] == str2[j]) j++;
            i++;
        }
        return j == str2.length;
    };

    const optimizedShortcuts = (targets) => {
        if (libraryNamesList.length === 0) return [];
        const allSubstrings = new Set(targets.map((t) => t.toLocaleLowerCase()).flatMap(getAllSubstrings).flatMap(mapToAlternativeSubstrings));
        let sortedSubstrings = Array.from(allSubstrings).sort((a, b) => a.length - b.length).filter(s => s.length <= MAX_SUBSTRING_LENGTH);

        let minPos = Infinity;
        let bestSubstring = "";
        let shortcuts = [];
        let altShortcuts = [];
        let currentLength = 0;
        let shortestLength = 999;
        let indexSlice = 0;
        let highlightedShortcuts = new Set();

        for (let substring of sortedSubstrings) {
            const newLength = substring.length;
            if (newLength > currentLength) {
                altShortcuts = altShortcuts.filter((s) => {
                    if (s.length === currentLength) {
                        shortcuts.push(s);
                        shortestLength = shortcuts[0].length;
                        return false;
                    }
                    return true;
                });
                if (shortcuts.length >= NUM_SHORTCUTS || newLength > shortestLength + MAX_LENGTH_DIFFERENTIAL) break;
            }
            indexSlice += 1;
            const suggestions = getSuggestions(substring);
            currentLength = newLength;

            const positions = targets.map((target) => suggestions.indexOf(target)).filter((pos) => pos != -1);
            if (positions.length) {
                const pos = Math.min(...positions);
                if (pos < minPos) {
                    minPos = pos;
                    bestSubstring = substring + "↓".repeat(pos);
                }
                substring = substring + "↓".repeat(pos);
                if (highlightedShortcuts.has(substring)) {
                    shortcuts.push(substring);
                    shortestLength = shortcuts[0].length;
                    continue;
                }
                if (substring.length > MAX_SUBSTRING_LENGTH || (TOP_SHORTCUTS_ONLY && pos > 0)) continue;
                const superStringQ = !FULL_SHORTCUTS ? shortcuts.concat(altShortcuts).filter((s) => s.length < substring.length).some((s) => supersequenceQ(substring, s)) : false;
                if (superStringQ) continue;

                if (pos == 0) {
                    shortcuts.push(substring);
                    shortestLength = shortcuts[0].length;
                } else {
                    altShortcuts.push(substring);
                }
            }
        }

        if (altShortcuts.length > 0 && shortcuts.length < NUM_SHORTCUTS) {
            const neededCount = Math.min(NUM_SHORTCUTS - shortcuts.length, altShortcuts.length);
            const maxAltLength = altShortcuts[neededCount - 1].length;
            shortcuts = shortcuts.concat(altShortcuts.filter((s) => s.length <= Math.min(maxAltLength, shortestLength + MAX_LENGTH_DIFFERENTIAL)));
        }
        return shortcuts.length ? shortcuts : (bestSubstring ? [bestSubstring] : []);
    };

    // =========================================================================
    // 9. INJECT INTO ANIME INFO
    // =========================================================================
    function patchAnimeExtendedInfo() {
        if (typeof LibraryAnimeEntry === "undefined") return;
        const origSetupExtendedInfo = LibraryAnimeEntry.prototype.setupExtendedInfo;
        LibraryAnimeEntry.prototype.setupExtendedInfo = function (showExpand, searchCallback) {
            origSetupExtendedInfo.call(this, showExpand, searchCallback);

            if (this.$body.find(".sayu-library-shortcuts-container").length > 0) return;

            let targets = [];
            if (this.animeEntry && this.animeEntry.names) {
                targets = this.animeEntry.names.map(n => n.name);
            } else if (this.animeEntry && this.animeEntry.mainName) {
                targets.push(this.animeEntry.mainName);
            }
            if (targets.length === 0) return;

            let shortcuts = optimizedShortcuts(targets);

            if (shortcuts && shortcuts.length > 0) {
                // Outer container uses native class for the 2x2 grid, inner uses Vivace flex layout
                let $shortcutContainer = $(`
                    <div class="elAnimeEntryInfoListContainer sayu-library-shortcuts-container">
                        <h4>Shortcuts</h4>
                        <div class="sayu-shortcuts-list" style="display: flex; flex-wrap: wrap; gap: 5px;"></div>
                    </div>
                `);

                let $list = $shortcutContainer.find(".sayu-shortcuts-list");
                shortcuts.forEach(sc => {
                    // Reverted back to the original Vivace code style
                    let $scLabel = $(`<code class="vivaceShortcut">${sc.replace(/ /g, "&nbsp;")}</code>`);
                    $list.append($scLabel);
                });

                // Fix for 1.7.4: $nameContainer was the Main Title. We must use $animeNameContainer (Alternative Names)
                let $target = null;
                if (this.$animeNameContainer && this.$animeNameContainer.length) {
                    $target = this.$animeNameContainer.closest(".elAnimeEntryInfoListContainer");
                    if ($target.length === 0) $target = this.$animeNameContainer;
                }

                if (!$target || $target.length === 0) {
                    if (this.$tagList && this.$tagList.length) {
                        $target = this.$tagList.closest(".elAnimeEntryInfoListContainer");
                        if ($target.length === 0) $target = this.$tagList.parent();
                    } else if (this.$genreList && this.$genreList.length) {
                        $target = this.$genreList.closest(".elAnimeEntryInfoListContainer");
                        if ($target.length === 0) $target = this.$genreList.parent();
                    }
                }

                if ($target && $target.length) {
                    $target.after($shortcutContainer);
                } else {
                    this.$body.find(".elAnimeEntryInfoContainer").append($shortcutContainer);
                }
            }
        };
    }

    // =========================================================================
    // 10. INITIALIZATION
    // =========================================================================
    async function main() {
        await waitForGameReady();
        console.log(`[${SCRIPT_NAME} v${VERSION}] Initializing...`);

        injectStyles();
        const uiElements = buildSearchUI();
        if (!uiElements) return;

        patchFilterApplier(uiElements);
        patchReset(uiElements);
        patchUpdateSearch(uiElements);
        hookInputEvents(uiElements);
        patchAnimeExtendedInfo();

        console.log(`[${SCRIPT_NAME} v${VERSION}] Successfully armed with Native Vivace! 🚀`);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", main);
    } else {
        main();
    }
})();

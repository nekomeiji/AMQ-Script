// ==UserScript==
// @name         AMQ Thai Names
// @namespace    https://github.com/nekomeiji/AMQ-Script
// @version      0.2.0
// @updateURL    https://raw.githubusercontent.com/nekomeiji/AMQ-Script/main/thai-names/amqThaiNames.user.js
// @downloadURL  https://raw.githubusercontent.com/nekomeiji/AMQ-Script/main/thai-names/amqThaiNames.user.js
// @description  Show and search Thai anime titles in the AMQ answer dropdown, with an in-game window to view and edit them.
// @author       nekomeiji
// @match        https://*.animemusicquiz.com/*
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	const BUNDLE_URL = 'https://raw.githubusercontent.com/nekomeiji/AMQ-Script/main/thai-names/bundle.json';
	const KEY_BUNDLE = 'amqThaiNamesBundle';
	const KEY_USER = 'amqThaiNamesUser';
	const THAI_RE = /[฀-๿]/;
	const PAGE_SIZE = 50;

	const store = {
		get(key, fallback) {
			try {
				const raw = localStorage.getItem(key);
				return raw ? JSON.parse(raw) : fallback;
			} catch (e) {
				return fallback;
			}
		},
		set(key, value) {
			try {
				localStorage.setItem(key, JSON.stringify(value));
				return true;
			} catch (e) {
				return false;
			}
		}
	};

	let bundle = store.get(KEY_BUNDLE, { v: 0, items: [], name_overrides: {} });
	let user = store.get(KEY_USER, {});
	let index = new Map();
	let sortKey = new Map();
	let partner = new Map();
	let lastAnimeNames = null;

	function rebuildIndex() {
		index = new Map();
		sortKey = new Map();
		partner = new Map();
		sortedCache.src = null;
		for (const [jp, en] of [...(bundle.pairs || []), ...bundle.items.map(i => [i[1], i[2]])]) {
			const key = (jp || en).toLowerCase();
			for (const name of [jp, en]) {
				if (name && !sortKey.has(name.toLowerCase())) sortKey.set(name.toLowerCase(), key);
			}
			if (jp && en && jp.toLowerCase() !== en.toLowerCase()) {
				if (!partner.has(jp.toLowerCase())) partner.set(jp.toLowerCase(), en);
				if (!partner.has(en.toLowerCase())) partner.set(en.toLowerCase(), jp);
			}
		}
		// Several anime can share one name string; show the shortest Thai title and keep the others searchable as alt.
		const groups = new Map();
		for (const [, jp, en, th, alt] of bundle.items) {
			for (const name of [jp, en]) {
				if (!name) continue;
				const key = name.toLowerCase();
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push({ th, alt: alt || [] });
			}
		}
		for (const [key, list] of groups) {
			list.sort((a, b) => a.th.length - b.th.length);
			const [main, ...rest] = list;
			const extra = new Set([...main.alt, ...rest.flatMap(r => [r.th, ...r.alt])]);
			extra.delete(main.th);
			index.set(key, { th: main.th, alt: [...extra], src: 'bundle' });
		}
		for (const [name, th] of Object.entries(bundle.name_overrides || {})) {
			index.set(name.toLowerCase(), { th, alt: [], src: 'bundle' });
		}
		for (const [name, th] of Object.entries(user)) {
			const entry = { th, alt: [], src: 'user' };
			index.set(name.toLowerCase(), entry);
			const other = partner.get(name.toLowerCase());
			if (other && !(other in user)) index.set(other.toLowerCase(), entry);
		}
	}

	function lookup(name) {
		return index.get(String(name).toLowerCase());
	}

	function esc(text) {
		return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	}

	function getController() {
		try {
			return quiz.answerInput.typingInput.autoCompleteController;
		} catch (e) {
			return null;
		}
	}

	function getNames() {
		const controller = getController();
		return controller && controller.list ? controller.list : [];
	}

	function refreshAutocomplete() {
		const controller = getController();
		if (controller && controller.list.length) controller.newList();
	}

	// Thai text also has to be reachable through letterLists, which is keyed by the first typed character.
	function addThaiLetters(inst) {
		for (const entry of inst.options.list) {
			const label = typeof entry === 'string' ? entry : entry.label;
			const found = lookup(label);
			if (!found) continue;
			const seen = new Set();
			for (const text of [found.th, ...found.alt]) {
				for (const ch of text.toLowerCase()) {
					if (!THAI_RE.test(ch) || seen.has(ch)) continue;
					seen.add(ch);
					(inst.letterLists[ch] = inst.letterLists[ch] || []).push(entry);
				}
			}
		}
	}

	function patchInstance(inst) {
		if (inst.atnPatched) return;
		inst.atnPatched = true;
		const origItem = inst.item;
		const origFilter = inst.filter;

		inst.item = function (text, input, itemId) {
			const li = origItem.call(this, text, input, itemId);
			const found = lookup(text.label || text);
			if (found && li) {
				const span = document.createElement('span');
				span.className = 'atn-th';
				span.textContent = found.th;
				li.appendChild(span);
			}
			return li;
		};

		inst.filter = function (text, input) {
			if (origFilter(text, input)) return true;
			const found = lookup(String(text));
			if (!found) return false;
			try {
				const re = new RegExp(input.trim(), 'i');
				return re.test(found.th) || found.alt.some(a => re.test(a));
			} catch (e) {
				return false;
			}
		};

		addThaiLetters(inst);
	}

	function wrapAutocomplete() {
		const Orig = window.AmqAwesomeplete;
		if (!Orig) {
			console.warn('[AMQ Thai Names] AmqAwesomeplete not found');
			return;
		}
		if (Orig.atnWrapped) return;
		function Wrapped(...args) {
			const inst = Reflect.construct(Orig, args, new.target || Wrapped);
			patchInstance(inst);
			return inst;
		}
		Wrapped.prototype = Orig.prototype;
		Wrapped.atnWrapped = true;
		window.AmqAwesomeplete = Wrapped;

		const controller = getController();
		if (controller && controller.awesomepleteInstance) patchInstance(controller.awesomepleteInstance);
	}

	function applyBundle(next) {
		bundle = next;
		store.set(KEY_BUNDLE, bundle);
		rebuildIndex();
		refreshAutocomplete();
	}

	function fetchBundle() {
		if (!BUNDLE_URL) return;
		fetch(BUNDLE_URL, { cache: 'no-cache' })
			.then(r => r.json())
			.then(next => {
				if (next && Array.isArray(next.items) && next.v > bundle.v) applyBundle(next);
			})
			.catch(e => console.warn('[AMQ Thai Names] bundle fetch failed', e));
	}

	function saveUser(name, th) {
		if (th) user[name] = th;
		else delete user[name];
		store.set(KEY_USER, user);
		rebuildIndex();
		refreshAutocomplete();
	}

	function download(filename, data) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	function readJsonFile(file, done) {
		const reader = new FileReader();
		reader.onload = () => {
			try {
				done(JSON.parse(reader.result));
			} catch (e) {
				alert('ไฟล์ JSON ไม่ถูกต้อง');
			}
		};
		reader.readAsText(file);
	}

	let win;
	let page = 0;
	const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
	let sortedCache = { src: null, len: 0, list: [] };

	// Sort by the jp name of the anime; en names and alt names follow their jp row (unknown strings sort as themselves).
	function compareNames(a, b) {
		const la = a.toLowerCase();
		const lb = b.toLowerCase();
		const ka = sortKey.get(la) || la;
		const kb = sortKey.get(lb) || lb;
		return collator.compare(ka, kb) || (Number(lb === kb) - Number(la === ka)) || collator.compare(a, b);
	}

	function sortedNames(names) {
		if (sortedCache.src !== names || sortedCache.len !== names.length) {
			sortedCache = { src: names, len: names.length, list: [...names].sort(compareNames) };
		}
		return sortedCache.list;
	}

	function buildWindow() {
		const style = document.createElement('style');
		style.textContent = `
			.atn-th { color: #9fd3ff; margin-left: 8px; font-size: 90%; }
			#atnWin { position: fixed; top: 50px; left: 50%; transform: translateX(-50%); width: 780px; max-width: 95vw; max-height: 88vh;
				display: none; flex-direction: column; background: #2b2b2b; color: #eee; border: 1px solid #555; border-radius: 6px; z-index: 10000; }
			#atnWin header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #555; }
			#atnWin header h4 { margin: 0; }
			#atnWin .atn-body { padding: 10px 12px; overflow-y: auto; }
			#atnWin input, #atnWin select { background: #1e1e1e; color: #eee; border: 1px solid #555; border-radius: 3px; padding: 4px 6px; }
			#atnWin button { background: #3a3a3a; color: #eee; border: 1px solid #666; border-radius: 3px; padding: 4px 10px; cursor: pointer; }
			#atnWin .atn-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; flex-wrap: wrap; }
			#atnWin .awesomplete { flex: 1 1 300px; position: relative; }
			#atnWin .awesomplete > input { width: 100%; box-sizing: border-box; }
			#atnWin .awesomplete > ul { z-index: 100000; color: #222; }
			#atnWin table { width: 100%; border-collapse: collapse; }
			#atnWin td, #atnWin th { padding: 3px 6px; border-bottom: 1px solid #444; text-align: left; vertical-align: top; }
			#atnWin .atn-src { font-size: 80%; opacity: .7; }
		`;
		document.head.appendChild(style);

		win = document.createElement('div');
		win.id = 'atnWin';
		win.innerHTML = `
			<header><h4>ชื่อไทย (AMQ Thai Names)</h4><button id="atnClose">✕</button></header>
			<div class="atn-body">
				<div class="atn-row">
					<input type="text" id="atnName" placeholder="พิมพ์เพื่อเลือกชื่อจาก dropdown ของเกม">
					<input type="text" id="atnTh" placeholder="ชื่อไทย" style="flex: 1 1 220px">
					<button id="atnSave">บันทึก</button>
					<button id="atnLast" title="ใช้ชื่ออนิเมะของเพลงล่าสุด">เพลงล่าสุด</button>
				</div>
				<div class="atn-row">
					<input type="text" id="atnSearch" placeholder="ค้นหา (ชื่อเกม หรือชื่อไทย)" style="flex: 1 1 260px">
					<select id="atnFilter">
						<option value="all">ทั้งหมด</option>
						<option value="has">มีชื่อไทย</option>
						<option value="missing">ยังไม่มีชื่อไทย</option>
						<option value="mine">ที่ฉันแก้เอง</option>
					</select>
					<label><input type="checkbox" id="atnOthers"> แสดงชื่ออื่น (EN/สำรอง)</label>
					<button id="atnExport">Export</button>
					<button id="atnImport">Import</button>
					<button id="atnImportBundle" title="โหลดไฟล์ bundle.json จากเครื่อง">Bundle</button>
					<input type="file" id="atnFile" accept=".json" style="display:none">
				</div>
				<div id="atnInfo" class="atn-src"></div>
				<table><thead><tr><th>ชื่อในเกม</th><th>ชื่อไทย</th><th></th></tr></thead><tbody id="atnRows"></tbody></table>
				<div class="atn-row" style="margin-top: 8px">
					<button id="atnPrev">‹</button><span id="atnPage"></span><button id="atnNext">›</button>
				</div>
			</div>`;
		document.body.appendChild(win);

		const $id = id => win.querySelector('#' + id);
		$id('atnClose').onclick = () => { win.style.display = 'none'; };
		$id('atnSave').onclick = () => {
			const name = $id('atnName').value.trim();
			if (!name) return;
			saveUser(name, $id('atnTh').value.trim());
			$id('atnTh').value = '';
			render();
		};
		$id('atnLast').onclick = () => {
			const an = lastAnimeNames;
			const name = an && typeof an === 'object' ? an.romaji || an.english : an;
			if (name) {
				$id('atnName').value = name;
				const found = lookup(name);
				$id('atnTh').value = found ? found.th : '';
			}
		};
		$id('atnSearch').oninput = () => { page = 0; render(); };
		$id('atnFilter').onchange = () => { page = 0; render(); };
		$id('atnOthers').onchange = () => { page = 0; render(); };
		$id('atnPrev').onclick = () => { page = Math.max(0, page - 1); render(); };
		$id('atnNext').onclick = () => { page++; render(); };
		$id('atnExport').onclick = () => download('thai_name_overrides.json', user);
		let importKind = 'user';
		$id('atnImport').onclick = () => { importKind = 'user'; $id('atnFile').click(); };
		$id('atnImportBundle').onclick = () => { importKind = 'bundle'; $id('atnFile').click(); };
		$id('atnFile').onchange = e => {
			const file = e.target.files[0];
			e.target.value = '';
			if (!file) return;
			readJsonFile(file, data => {
				if (importKind === 'bundle' && Array.isArray(data.items)) applyBundle(data);
				else if (importKind === 'user' && data && typeof data === 'object') {
					Object.assign(user, data);
					store.set(KEY_USER, user);
					rebuildIndex();
					refreshAutocomplete();
				}
				render();
			});
		};

		win.addEventListener('click', e => {
			const edit = e.target.closest('[data-edit]');
			const del = e.target.closest('[data-del]');
			if (edit) {
				const name = edit.dataset.edit;
				$id('atnName').value = name;
				const found = lookup(name);
				$id('atnTh').value = found ? found.th : '';
			} else if (del) {
				saveUser(del.dataset.del, '');
				render();
			}
		});
	}

	function render() {
		const $id = id => win.querySelector('#' + id);
		const query = $id('atnSearch').value.trim().toLowerCase();
		const filter = $id('atnFilter').value;
		const names = filter === 'mine' ? Object.keys(user).sort(compareNames) : sortedNames(getNames());
		const rows = [];
		const showOthers = $id('atnOthers').checked;
		for (const name of names) {
			const lower = name.toLowerCase();
			if (filter !== 'mine' && !showOthers && sortKey.size && sortKey.get(lower) !== lower) continue;
			const found = lookup(name);
			if (filter === 'has' && !found) continue;
			if (filter === 'missing' && found) continue;
			if (query && !name.toLowerCase().includes(query) && !(found && found.th.toLowerCase().includes(query))) continue;
			rows.push([name, found]);
		}
		const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
		page = Math.min(page, pages - 1);
		$id('atnRows').innerHTML = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(([name, found]) => `
			<tr>
				<td>${esc(name)}</td>
				<td>${found ? esc(found.th) : ''} ${found ? `<span class="atn-src">${found.src === 'user' ? 'แก้เอง' : 'bundle'}</span>` : ''}</td>
				<td><button data-edit="${esc(name)}">✎</button>${name in user ? ` <button data-del="${esc(name)}">🗑</button>` : ''}</td>
			</tr>`).join('');
		$id('atnPage').textContent = `${page + 1} / ${pages} (${rows.length})`;
		$id('atnInfo').textContent = `bundle v${bundle.v}, ${bundle.items.length} เรื่อง, แก้เอง ${Object.keys(user).length} ชื่อ` +
			(names.length ? '' : ' | รายชื่อในเกมยังไม่โหลด (เข้าห้องเกมก่อน)');
	}

	function attachDropdown() {
		const input = win.querySelector('#atnName');
		const names = getNames();
		if (!names.length || input.dataset.atnReady === String(names.length)) return;
		if (input.atnComplete) input.atnComplete.destroy();
		input.atnComplete = new window.AmqAwesomeplete(input, { list: names, minChars: 1, maxItems: 25 }, true);
		input.dataset.atnReady = String(names.length);
	}

	function openWindow() {
		win.style.display = 'flex';
		attachDropdown();
		render();
	}

	function init() {
		rebuildIndex();
		wrapAutocomplete();
		buildWindow();

		const item = $('<li class="clickAble">ชื่อไทย</li>');
		item.on('click', () => (win.style.display === 'flex' ? (win.style.display = 'none') : openWindow()));
		$('#optionsContainer > ul').prepend(item);

		new Listener('answer results', payload => {
			lastAnimeNames = payload && payload.songInfo ? payload.songInfo.animeNames : null;
		}).bindListener();
		new Listener('get all song names', () => setTimeout(() => { if (win.style.display === 'flex') { attachDropdown(); render(); } }, 100)).bindListener();

		fetchBundle();
	}

	const timer = setInterval(() => {
		const loading = document.getElementById('loadingScreen');
		if (typeof $ === 'undefined' || typeof Listener === 'undefined' || !loading || !loading.classList.contains('hidden')) return;
		clearInterval(timer);
		init();
	}, 500);
})();

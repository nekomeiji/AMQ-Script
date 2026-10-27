// ==UserScript==
// @name         AMQ Roll All Players
// @namespace    https://github.com/nekomeiji/AMQ-Script
// @version      1.0
// @description  Adds /roll ap command to roll all players in a queue
// @author       nekomeiji
// @match        https://*.animemusicquiz.com/*
// @grant        unsafeWindow
// @require      https://github.com/joske2865/AMQ-Scripts/raw/master/common/amqScriptInfo.js
// ==/UserScript==

"use strict";

if (typeof Listener === "undefined") return;

let commandPrefix = "/";

function getPlayerList() {
    if (typeof quiz !== "undefined" && quiz.inQuiz) {
        return Object.values(quiz.players).map(p => p._name);
    }
    else if (typeof lobby !== "undefined" && lobby.inLobby) {
        return Object.values(lobby.players).map(p => p._name);
    }
    return [];
}

function shuffleArray(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex != 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

function sendChatMessage(msg) {
    // Split message if it's too long (AMQ chat limit is 150 chars)
    const MAX_LENGTH = 145;
    if (msg.length <= MAX_LENGTH) {
        if (socket && typeof socket.sendCommand === "function") {
            socket.sendCommand({ type: "lobby", command: "game chat message", data: { msg: String(msg), teamMessage: false } });
        }
    } else {
        let parts = msg.split(" ➜ ");
        let currentMsg = "";
        for (let part of parts) {
            if (currentMsg.length + part.length + 3 > MAX_LENGTH) {
                socket.sendCommand({ type: "lobby", command: "game chat message", data: { msg: String(currentMsg), teamMessage: false } });
                currentMsg = part;
            } else {
                currentMsg += (currentMsg.length === 0 ? "" : " ➜ ") + part;
            }
        }
        if (currentMsg.length > 0) {
            socket.sendCommand({ type: "lobby", command: "game chat message", data: { msg: String(currentMsg), teamMessage: false } });
        }
    }
}

new Listener("Game Chat Message", (data) => {
    if (data.sender === selfName && data.message.startsWith(commandPrefix)) {
        if (data.message.toLowerCase() === "/roll ap") {
            const list = getPlayerList();
            if (list.length > 0) {
                const shuffled = shuffleArray(list);
                shuffled.forEach((name, index) => {
                    setTimeout(() => sendChatMessage(`${index + 1}. ${name}`), (index + 1) * 300);
                });
            } else {
                setTimeout(() => sendChatMessage("no players to roll"), 100);
            }
        }
    }
}).bindListener();

new Listener("game chat update", (data) => {
    for (const message of data.messages) {
        if (message.sender === selfName && message.message.startsWith(commandPrefix)) {
            if (message.message.toLowerCase() === "/roll ap") {
                const list = getPlayerList();
                if (list.length > 0) {
                    const shuffled = shuffleArray(list);
                    shuffled.forEach((name, index) => {
                        setTimeout(() => sendChatMessage(`${index + 1}. ${name}`), (index + 1) * 300);
                    });
                } else {
                    setTimeout(() => sendChatMessage("no players to roll"), 100);
                }
            }
        }
    }
}).bindListener();

import puppeteer, { Browser, Page } from "puppeteer";

export const sleep = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

export const createBrowserAndPage = async () => {
    const browser = await puppeteer.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({
        width: 1364,
        height: 764,
    });
    return { browser, page };
};
export const login = async (page: Page, key: string) => {
    await page.goto("http://localhost:8081/", { timeout: 90000 });
    await page.evaluate(() => {});
    await page.$eval('button[type="button"]', (el) => el.click());
    await page.waitForSelector("input[name='privatekey']");
    await page.focus("input[name='privatekey']");
    await page.keyboard.sendCharacter(key);
    await page.keyboard.press("Enter");
};
export const searchRoomMember = async (page: Page, text: string) => {
    await page.$eval(".people-drawer__sticky .people-search input", (el) => {
        el.value = "";
        el.focus();
    });
    await page.waitForTimeout(0.5 * 1000);

    await page.keyboard.sendCharacter(text);
};

export const findTimeLineLastImage = (page: Page, text: string, type: string = "image"): Promise<string> => {
    let t: number;
    let count = 0;
    return new Promise((res) => {
        t = setInterval(async () => {
            count += 1;
            let name = "";
            try {
                if (type === "image") {
                    name = await page.$eval(".timeline__wrapper>div:last-child img", (el) => {
                        return el.alt;
                    });
                } else if (type === "emoji") {
                    name = await page.$eval(".timeline__wrapper>div:last-child .message__reactions img", (el) => {
                        return el.alt;
                    });
                } else {
                    name = await page.$eval(".timeline__wrapper>div:last-child p", (el) => {
                        return el.innerText;
                    });
                }
            } catch (e) {}

            if (name === text) {
                clearInterval(t);
                res(name);
            } else if (count > 10) {
                // 错误了
                throw Error("传送错误");
            }
        }, 1000);
    });
};

export const findTimeLineText = async (page: Page, text: string): Promise<string> => {
    // 在时间tiemlien 中找到消息
    let t: number;
    let count = 0;
    return await new Promise((res) => {
        t = setInterval(async () => {
            let name = "";
            try {
                name = await page.$$eval(
                    ".timeline__wrapper>div .message__body p",
                    (el, matchText) => {
                        let result = "";
                        el.forEach((i) => {
                            if (i.innerText === matchText) {
                                result = i.innerText;
                            }
                        });

                        return result;
                    },
                    text,
                );
            } catch (e) {}
            if (name === text) {
                clearInterval(t);
                res(name);
            } else if (count > 10) {
                expect(name).toEqual(text);
                clearInterval(t);
                // 错误了
                throw Error("传送错误");
            }
            count += 1;
        }, 1000);
    });
};

export const sendEmojitoLast = async (page: Page) => {
    await page.waitForSelector(".timeline__wrapper");
    await page.hover(".timeline__wrapper>div:last-child");
    await page.waitForSelector(".timeline__wrapper");
    await page.$eval(".timeline__wrapper>div:last-child .message__options button", (el) => {
        el.click();
    });
    await page.waitForSelector(".emoji-board .emoji-row span");
    const clickAlt = await page.$eval(".emoji-board .emoji-row span img", (el) => {
        return el.alt;
    });
    await page.$eval(".emoji-board .emoji-row span img", (el) => {
        el.click();
    });
    await page.waitForTimeout(1 * 1000);
    return clickAlt;
};
export const sendMessage = async (page: Page, content: string, delay: number = 0) => {
    await page.waitForSelector(".room-input__input-container");
    await page.$eval(".room-input__input-container textarea", async (el) => {
        el.focus();
    });
    await page.keyboard.sendCharacter(content);
    await page.waitForTimeout(0.5 * 1000 + delay);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3 * 1000);
};
export const sendFile = async (page: Page, path: string = "spec/test.png", delay: number = 0) => {
    await page.waitForSelector(".room-input__input-container");
    const elementHandle = await page.$("input[type=file]");
    await elementHandle!.uploadFile(path);
    await page.waitForSelector(".room-attachment__info");
    await page.waitForTimeout(1 * 1000 + delay);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1 * 1000);
};
export const privateChatFromRoom = async (page: Page, key: string, delay: number = 0) => {
    // 从房间中找到一个用户并且发一条私聊消息
    await searchRoomMember(page, key);

    await page.waitForSelector(".people-drawer__sticky .people-search");
    await page.$eval(".people-selector__container button", (el) => {
        return el.click();
    });
    await page.waitForTimeout(1 * 1000);

    await page.waitForSelector(".profile-viewer__buttons button");
    await page.click(".profile-viewer__buttons button");
    await page.waitForTimeout(4 * 1000);
    // 随机加入一个房间
    const text = `私聊信息${Math.random()}`;
    await sendMessage(page, text, delay);

    return { text };
};
export const enterPublicRoom = async (page: Page, roomName: string = "房间1号") => {
    await page.waitForSelector(".header button");
    const header = await page.$(".header");
    await header?.$eval("button", (e) => {
        e.click();
    });
    await page.waitForSelector(".context-menu__item");
    await page.waitForTimeout(1 * 1000);

    await page.$$eval(".context-menu__item button", (el) => {
        el[1].click();
    });
    await page.waitForSelector(".public-rooms__input-wrapper");
    await page.waitForTimeout(3 * 1000);
    await page.$eval(".public-rooms__form button", (el) => {
        el.click();
    });
    // 随机加入一个房间
    await page.waitForSelector(".public-rooms__content button");
    await page.waitForTimeout(3 * 1000);

    await page.$eval(".public-rooms__content button", (el) => {
        el.click();
    });
    try {
        await page.$eval(".pw__content .header button", (el) => {
            el.click();
        });
    } catch (e) {}

    await page.waitForSelector(".room-selector__content");

    await page.$$eval(
        ".room-selector__content",
        (el, roomName) => {
            el.map((i) => {
                if (i.querySelectorAll("p")[0].innerText === roomName) {
                    i.click();
                }
            });
        },
        roomName,
    );
    await page.waitForSelector(".room-input__input-container");

    // await page.waitForTimeout(2 * 1000);
    // 随机加入一个房间
    // const text = `又来房间了${Math.random()}`;
    // await page.$eval(".room-input__input-container textarea", async (el) => {
    //     el.focus();
    // });
    // await page.keyboard.sendCharacter(text);
    // await page.waitForTimeout(0.5 * 1000);
    // await page.keyboard.press("Enter");
    // await page.waitForTimeout(3 * 1000);
};

export const createPrivateMessageRoomWithPubKey = async (page: Page, pubkey: string) => {
    await page.click(".featured-container button:nth-child(2)");
    await page.waitForSelector(".header button");
    await page.waitForTimeout(1 * 1000);
    await page.click(".header button");
    await page.waitForSelector(".pw__content-container .invite-user__form input");

    await page.focus(".pw__content-container .invite-user__form input");
    await page.keyboard.sendCharacter(pubkey);
    await page.waitForTimeout(0.5 * 1000);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".room-tile__options button");
    await page.click(".room-tile__options button");
    await page.waitForTimeout(2 * 1000);
};

export const leaveRoom = async (page: Page) => {
    await page.waitForSelector(".room-header__btn");
    await page.click(".room-header__btn");
    await page.waitForTimeout(2 * 1000);

    await page.click(".room-settings__card .context-menu__item:nth-child(3) button");
    await page.waitForTimeout(2 * 1000);
    await page.waitForSelector(".confirm-dialog__btn button");
    await page.click(".confirm-dialog__btn button");
    await page.waitForTimeout(2 * 1000);
};

export const searchLocalUserAndEnterRoom = async (page: Page, pubkey: string) => {
    await page.waitForSelector(".sidebar__sticky .sticky-container button");

    await page.click(".sidebar__sticky .sticky-container button");
    await page.waitForTimeout(1 * 1000);
    await page.waitForSelector(".search-dialog__input input");

    await page.focus(".search-dialog__input input");
    await page.keyboard.sendCharacter(pubkey);
    await page.waitForSelector(".search-dialog__content button");
    await page.click(".search-dialog__content button");
    await page.waitForTimeout(2 * 1000);
};

export const updateUserMeta = async (page: Page) => {};

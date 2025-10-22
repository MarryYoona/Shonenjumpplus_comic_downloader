// ==UserScript==
// @name         shonenjumpplus_comic_downloader
// @namespace
// @version      2023-06-12
// @description  支持760*1200/764×1200/822×1200/844×1200分辨率
// @author       DHM
// @match        https://shonenjumpplus.com/episode/*
// @grant        GM_addStyle
// @grant        GM_download
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';
    const CONFIG = {
        WAIT_TIME: 8000,
        EPISODE_JSON_ID: 'episode-json',
        READABLE_PRODUCT_FIELD: 'readableProduct',
        PAGE_STRUCTURE_FIELD: 'pageStructure',
        PAGES_FIELD: 'pages',
        RESTORE_IMAGE_REGEX: /\/public\/page\//,
        RESOLUTION_MAP: {
            "764×1200": { RECT_FIXED_WIDTH: 736, RECT_FIXED_HEIGHT: 1184 },
            "822×1200": { RECT_FIXED_WIDTH: 800, RECT_FIXED_HEIGHT: 1184 },
            "844×1200": { RECT_FIXED_WIDTH: 832, RECT_FIXED_HEIGHT: 1184 }
        },
        DEFAULT_RECT: { RECT_FIXED_WIDTH: 736, RECT_FIXED_HEIGHT: 1184 },
        RECT_OFFSET_X: 0,
        RECT_OFFSET_Y: 0,
        CHUNK_ROWS: 4,
        CHUNK_COLS: 4
    };

    let comicImageList = [];
    let previewModal = null;
    let restoreTip = null;
    let downloadTip = null;
    let isUIAlive = true;

    GM_addStyle(`
        .comic-img-extractor { position: fixed; top: 20px; right: 20px; width: 450px; max-height: 80vh; overflow-y: auto; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); z-index: 9999; padding: 15px; }
        .extractor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #f0f0f0; }
        .extractor-title { font-size: 16px; font-weight: bold; color: #333; margin: 0; }
        .close-btn { background: transparent; border: none; font-size: 18px; color: #999; cursor: pointer; padding: 0 5px; }
        .close-btn:hover { color: #ff4444; }
        .extractor-btns { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
        .action-btn { flex: 1; min-width: 120px; padding: 8px 0; background: #2196F3; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; text-align: center; }
        .restore-btn { background: #FF7043; }
        .download-all-btn { background: #4CAF50; }
        .img-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 0; padding: 0; list-style: none; }
        .img-item { border: 2px solid #f0f0f0; border-radius: 4px; overflow: hidden; cursor: pointer; position: relative; }
        .img-item.original { border-color: #4CAF50; }
        .img-item.restore { border-color: #FF7043; }
        .img-thumbnail { width: 100%; height: auto; display: block; }
        .img-tag { position: absolute; top: 4px; left: 4px; font-size: 10px; padding: 2px 6px; border-radius: 2px; color: #fff; font-weight: bold; }
        .img-tag.restore { background: #FF7043; }
        .img-tag.original { background: #4CAF50; }
        .img-actions { display: flex; justify-content: space-between; padding: 4px; background: #fafafa; border-top: 1px solid #f0f0f0; }
        .img-action-btn { font-size: 12px; padding: 2px 6px; border: none; border-radius: 2px; cursor: pointer; color: #fff; }
        .restore-single-btn { background: #FF7043; }
        .download-single-btn { background: #2196F3; }
        .img-index { font-size: 12px; color: #666; text-align: center; padding: 4px 0; background: #fafafa; }
        .preview-modal { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.9); z-index: 10000; display: flex; justify-content: center; align-items: center; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
        .preview-modal.show { opacity: 1; pointer-events: auto; }
        .preview-img { max-width: 95%; max-height: 90vh; border: 4px solid #fff; border-radius: 4px; }
        .close-preview { position: absolute; top: 20px; right: 20px; font-size: 24px; color: #fff; cursor: pointer; }
        .tip-box { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: #fff; padding: 12px 24px; border-radius: 4px; font-size: 14px; z-index: 10000; opacity: 0; transition: opacity 0.3s; }
        .tip-box.show { opacity: 1; }
        .error-message { grid-column: 1/-1; text-align: center; padding: 20px; color: #ff4444; font-size: 14px; background: #fff8f8; border: 1px solid #ffcccc; border-radius: 4px; }
    `);

    function safeGet(obj, paths, defaultValue = undefined) {
        return paths.reduce((acc, path) => {
            if (acc === null || acc === undefined) return defaultValue;
            return acc[path] ?? defaultValue;
        }, obj);
    }

    function waitForEpisodeJson() {
        return new Promise((resolve, reject) => {
            let waitTime = 0;
            const checkInterval = 300;
            const maxWaitTime = CONFIG.WAIT_TIME;
            const checkTimer = setInterval(() => {
                if (!isUIAlive) {
                    clearInterval(checkTimer);
                    reject(new Error("UI已关闭,停止提取图片数据"));
                    return;
                }
                waitTime += checkInterval;
                const jsonScript = document.getElementById(CONFIG.EPISODE_JSON_ID);
                if (jsonScript && jsonScript.hasAttribute('data-value')) {
                    clearInterval(checkTimer);
                    resolve(jsonScript);
                }
                if (waitTime >= maxWaitTime) {
                    clearInterval(checkTimer);
                    reject(new Error(`超时${maxWaitTime}ms未找到episode-json,请刷新页面重试`));
                }
            }, checkInterval);
        });
    }

    function getRectConfigByResolution(imgWidth, imgHeight) {
        const key = `${imgWidth}×${imgHeight}`;
        return CONFIG.RESOLUTION_MAP[key] || CONFIG.DEFAULT_RECT;
    }

    function calculateRectSize(imgWidth, imgHeight) {
        const { RECT_FIXED_WIDTH, RECT_FIXED_HEIGHT } = getRectConfigByResolution(imgWidth, imgHeight);
        const rectX = CONFIG.RECT_OFFSET_X;
        const rectY = CONFIG.RECT_OFFSET_Y;
        if (imgWidth < RECT_FIXED_WIDTH || imgHeight < RECT_FIXED_HEIGHT) {
            throw new Error(`原图(${imgWidth}×${imgHeight}px)小于所需尺寸(${RECT_FIXED_WIDTH}×${RECT_FIXED_HEIGHT}px)`);
        }
        return { rectWidth: RECT_FIXED_WIDTH, rectHeight: RECT_FIXED_HEIGHT, rectX, rectY };
    }

    function restoreSplitImage(restoreImgSrc, pageIndex) {
        return new Promise((resolve, reject) => {
            if (!isUIAlive) { reject(new Error("UI已关闭")); return; }
            const restoreImg = new Image();
            restoreImg.crossOrigin = 'anonymous';
            restoreImg.src = restoreImgSrc.includes('?') ? `${restoreImgSrc}&t=${Date.now()}` : `${restoreImgSrc}?t=${Date.now()}`;

            restoreImg.onabort = () => reject(new Error("图片加载被取消"));
            restoreImg.onload = () => {
                try {
                    if (!isUIAlive) throw new Error("UI已关闭");
                    const imgWidth = restoreImg.width;
                    const imgHeight = restoreImg.height;
                    if (imgWidth === 0 || imgHeight === 0) throw new Error("原图尺寸为0");

                    const { rectWidth, rectHeight, rectX, rectY } = calculateRectSize(imgWidth, imgHeight);
                    const chunkWidth = rectWidth / CONFIG.CHUNK_COLS;
                    const chunkHeight = rectHeight / CONFIG.CHUNK_ROWS;
                    if (!Number.isInteger(chunkWidth) || !Number.isInteger(chunkHeight)) {
                        throw new Error(`分割尺寸非整数(${rectWidth}×${rectHeight}px)`);
                    }

                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = imgWidth;
                    canvas.height = imgHeight;

                    const rightStartX = rectX + rectWidth;
                    if (rightStartX < imgWidth) {
                        ctx.drawImage(restoreImg, rightStartX, 0, imgWidth - rightStartX, imgHeight, rightStartX, 0, imgWidth - rightStartX, imgHeight);
                    }
                    const bottomStartY = rectY + rectHeight;
                    if (bottomStartY < imgHeight) {
                        ctx.drawImage(restoreImg, rectX, bottomStartY, rectWidth, imgHeight - bottomStartY, rectX, bottomStartY, rectWidth, imgHeight - bottomStartY);
                    }

                    const restoreMap = {
                        "1,1": [1,1], "2,2": [2,2], "3,3": [3,3], "4,4": [4,4],
                        "1,2": [2,1], "1,3": [3,1], "1,4": [4,1],
                        "2,1": [1,2], "2,3": [3,2], "2,4": [4,2],
                        "3,1": [1,3], "3,2": [2,3], "3,4": [4,3],
                        "4,1": [1,4], "4,2": [2,4], "4,3": [3,4]
                    };
                    for (let row = 1; row <= CONFIG.CHUNK_ROWS; row++) {
                        for (let col = 1; col <= CONFIG.CHUNK_COLS; col++) {
                            if (!isUIAlive) throw new Error("UI已关闭");
                            const [targetRow, targetCol] = restoreMap[`${row},${col}`] || [row, col];
                            const srcX = rectX + (col - 1) * chunkWidth;
                            const srcY = rectY + (row - 1) * chunkHeight;
                            const targetX = rectX + (targetCol - 1) * chunkWidth;
                            const targetY = rectY + (targetRow - 1) * chunkHeight;
                            ctx.drawImage(restoreImg, srcX, srcY, chunkWidth, chunkHeight, targetX, targetY, chunkWidth, chunkHeight);
                        }
                    }
                    resolve(canvas.toDataURL('image/jpeg', 0.95));
                } catch (error) {
                    console.error(`第${pageIndex}页还原失败:`, error);
                    reject(new Error(`还原失败:${error.message}`));
                }
            };
            restoreImg.onerror = () => {
                reject(new Error(`图片加载失败(跨域):${restoreImgSrc},请关闭浏览器跟踪防护`));
            };
        });
    }

    async function extractRestoreImages() {
        try {
            if (!isUIAlive) throw new Error("UI已关闭");
            const jsonScript = await waitForEpisodeJson();
            const jsonStr = jsonScript.getAttribute('data-value');
            if (!jsonStr) throw new Error('episode-json无数据');

            const comicData = JSON.parse(jsonStr);
            const readableProduct = safeGet(comicData, [CONFIG.READABLE_PRODUCT_FIELD]);
            if (!readableProduct) throw new Error(`未找到${CONFIG.READABLE_PRODUCT_FIELD}字段`);

            const pageStructure = safeGet(readableProduct, [CONFIG.PAGE_STRUCTURE_FIELD]);
            if (!pageStructure) throw new Error(`未找到${CONFIG.PAGE_STRUCTURE_FIELD}字段`);

            const pages = safeGet(pageStructure, [CONFIG.PAGES_FIELD], []);
            if (!Array.isArray(pages)) throw new Error(`${CONFIG.PAGES_FIELD}不是数组`);

            comicImageList = pages
                .filter(page => page?.src && page?.type === 'main' && CONFIG.RESTORE_IMAGE_REGEX.test(page.src))
                .map((page, index) => ({ src: page.src, index: index + 1, restoredSrc: '', isRestored: false }));

            if (comicImageList.length === 0) throw new Error(`未找到符合条件的图片(URL需含${CONFIG.RESTORE_IMAGE_REGEX})`);
            return { isError: false };
        } catch (error) {
            console.error('提取错误:', error);
            return { isError: true, message: error.message };
        }
    }

    function getPaddedPageNum(pageIndex, totalPages) {
        const padLength = totalPages >= 100 ? 3 : (totalPages >= 10 ? 2 : 1);
        return pageIndex.toString().padStart(padLength, '0');
    }

    function renderImageList(imgListElement, previewImg, extractResult) {
        if (!isUIAlive || !imgListElement) return;
        imgListElement.innerHTML = '';
        if (extractResult.isError) {
            const errorLi = document.createElement('li');
            errorLi.className = 'error-message';
            errorLi.innerHTML = `<p>提取失败:${extractResult.message}</p><p style="margin-top:8px;font-size:12px;color:#666;text-align:left;">解决方案:<br>1.关闭浏览器跟踪防护和广告拦截<br>2.刷新页面重试<br>3.确认页面URL含/episode/</p>`;
            imgListElement.appendChild(errorLi);
            return;
        }

        const totalPages = comicImageList.length;
        comicImageList.forEach(imgItem => {
            const li = document.createElement('li');
            li.className = `img-item ${imgItem.isRestored ? 'original' : 'restore'}`;
            li.dataset.pageIndex = imgItem.index;

            const tag = document.createElement('div');
            tag.className = `img-tag ${imgItem.isRestored ? 'original' : 'restore'}`;
            tag.textContent = imgItem.isRestored ? '已还原' : '待还原';
            li.appendChild(tag);

            const img = document.createElement('img');
            img.className = 'img-thumbnail';
            img.src = imgItem.isRestored ? imgItem.restoredSrc : imgItem.src;
            img.alt = `第${imgItem.index}页`;
            img.onclick = () => {
                if (isUIAlive && previewModal && previewImg) {
                    previewImg.src = imgItem.isRestored ? imgItem.restoredSrc : imgItem.src;
                    previewModal.classList.add('show');
                }
            };
            li.appendChild(img);

            const actionDiv = document.createElement('div');
            actionDiv.className = 'img-actions';
            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'img-action-btn restore-single-btn';
            restoreBtn.textContent = '还原';
            restoreBtn.disabled = imgItem.isRestored;
            restoreBtn.dataset.pageIndex = imgItem.index;
            actionDiv.appendChild(restoreBtn);

            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'img-action-btn download-single-btn';
            downloadBtn.textContent = '下载';
            downloadBtn.disabled = !imgItem.isRestored;
            downloadBtn.dataset.pageIndex = imgItem.index;
            actionDiv.appendChild(downloadBtn);
            li.appendChild(actionDiv);

            const indexSpan = document.createElement('span');
            indexSpan.className = 'img-index';
            indexSpan.textContent = `第${imgItem.index}页`;
            li.appendChild(indexSpan);

            restoreBtn.onclick = async () => {
                if (!isUIAlive) return;
                const pageIndex = parseInt(restoreBtn.dataset.pageIndex);
                const currentRestoreBtn = document.querySelector(`.img-item[data-page-index="${pageIndex}"] .restore-single-btn`);
                if (!currentRestoreBtn) { alert(`第${pageIndex}页还原按钮不存在`); return; }
                currentRestoreBtn.textContent = '还原中...';
                currentRestoreBtn.disabled = true;

                try {
                    const restoredSrc = await restoreSplitImage(imgItem.src, pageIndex);
                    if (!isUIAlive) return;
                    const index = comicImageList.findIndex(item => item.index === pageIndex);
                    if (index === -1) throw new Error(`未找到第${pageIndex}页数据`);
                    comicImageList[index] = { ...imgItem, restoredSrc, isRestored: true };
                    renderImageList(imgListElement, previewImg, { isError: false });
                    if (restoreTip) {
                        restoreTip.textContent = `第${pageIndex}页还原成功`;
                        restoreTip.classList.add('show');
                        setTimeout(() => restoreTip?.classList.remove('show'), 3000);
                    }
                } catch (error) {
                    alert(`第${pageIndex}页还原失败:${error.message}`);
                    if (currentRestoreBtn) { currentRestoreBtn.textContent = '还原'; currentRestoreBtn.disabled = false; }
                }
            };

            downloadBtn.onclick = () => {
                if (!isUIAlive) return;
                const pageIndex = parseInt(downloadBtn.dataset.pageIndex);
                const paddedNum = getPaddedPageNum(pageIndex, totalPages);
                GM_download({
                    url: imgItem.restoredSrc,
                    name: `${paddedNum}.jpg`,
                    mimetype: 'image/jpeg',
                    onload: () => {
                        if (downloadTip) {
                            downloadTip.textContent = `第${pageIndex}页下载完成`;
                            downloadTip.classList.add('show');
                            setTimeout(() => downloadTip?.classList.remove('show'), 2000);
                        }
                    },
                    onerror: (err) => alert(`第${pageIndex}页下载失败:${err.error || '未知错误'}`)
                });
            };

            imgListElement.appendChild(li);
        });

        const downloadAllBtn = document.querySelector('.download-all-btn');
        downloadAllBtn.disabled = !comicImageList.some(img => img.isRestored);
    }

    async function createUI() {
        isUIAlive = true;
        const extractorDiv = document.createElement('div');
        extractorDiv.className = 'comic-img-extractor';
        extractorDiv.addEventListener('remove', () => {
            isUIAlive = false;
            previewModal = null;
            restoreTip = null;
            downloadTip = null;
            comicImageList = [];
        });

        const header = document.createElement('div');
        header.className = 'extractor-header';
        const title = document.createElement('h3');
        title.className = 'extractor-title';
        title.textContent = 'shonenjumpplus漫画下载器';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.textContent = '×';
        closeBtn.onclick = () => {
            extractorDiv.remove();
            previewModal?.remove();
            restoreTip?.remove();
            downloadTip?.remove();
            isUIAlive = false;
        };
        header.appendChild(title);
        header.appendChild(closeBtn);
        extractorDiv.appendChild(header);

        const btnContainer = document.createElement('div');
        btnContainer.className = 'extractor-btns';
        const restoreAllBtn = document.createElement('button');
        restoreAllBtn.className = 'action-btn restore-btn';
        restoreAllBtn.textContent = '还原所有重组图';
        const downloadAllBtn = document.createElement('button');
        downloadAllBtn.className = 'action-btn download-all-btn';
        downloadAllBtn.textContent = '下载所有还原图';
        downloadAllBtn.disabled = true;
        btnContainer.appendChild(restoreAllBtn);
        btnContainer.appendChild(downloadAllBtn);
        extractorDiv.appendChild(btnContainer);

        const imgList = document.createElement('ul');
        imgList.className = 'img-list';
        extractorDiv.appendChild(imgList);

        previewModal = document.createElement('div');
        previewModal.className = 'preview-modal';
        const closePreview = document.createElement('div');
        closePreview.className = 'close-preview';
        closePreview.textContent = '×';
        closePreview.onclick = () => previewModal?.classList.remove('show');
        const previewImg = document.createElement('img');
        previewImg.className = 'preview-img';
        previewModal.appendChild(closePreview);
        previewModal.appendChild(previewImg);

        restoreTip = document.createElement('div');
        restoreTip.className = 'tip-box';
        downloadTip = document.createElement('div');
        downloadTip.className = 'tip-box';

        document.body.appendChild(extractorDiv);
        document.body.appendChild(previewModal);
        document.body.appendChild(restoreTip);
        document.body.appendChild(downloadTip);

        const extractResult = await extractRestoreImages();
        renderImageList(imgList, previewImg, extractResult);

        if (!extractResult.isError) {
            restoreAllBtn.onclick = async () => {
                if (!isUIAlive) return;
                restoreAllBtn.textContent = '还原中...';
                restoreAllBtn.disabled = true;
                try {
                    const totalPages = comicImageList.length;
                    for (let i = 0; i < totalPages; i++) {
                        if (!isUIAlive) throw new Error("UI已关闭");
                        const imgItem = comicImageList[i];
                        if (imgItem.isRestored) continue;
                        const pageIndex = imgItem.index;
                        const currentRestoreBtn = document.querySelector(`.img-item[data-page-index="${pageIndex}"] .restore-single-btn`);
                        if (currentRestoreBtn) { currentRestoreBtn.textContent = '还原中...'; currentRestoreBtn.disabled = true; }

                        const restoredSrc = await restoreSplitImage(imgItem.src, pageIndex);
                        if (!isUIAlive) return;
                        comicImageList[i] = { ...imgItem, restoredSrc, isRestored: true };
                        renderImageList(imgList, previewImg, { isError: false });
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    downloadAllBtn.disabled = false;
                    if (restoreTip) {
                        restoreTip.textContent = '所有图片还原成功';
                        restoreTip.classList.add('show');
                        setTimeout(() => restoreTip?.classList.remove('show'), 3000);
                    }
                } catch (error) {
                    alert(`批量还原失败:${error.message}(已还原部分图片)`);
                } finally {
                    restoreAllBtn.textContent = '还原所有重组图';
                    restoreAllBtn.disabled = false;
                }
            };

            downloadAllBtn.onclick = async () => {
                if (!isUIAlive) return;
                const restoredImages = comicImageList.filter(img => img.isRestored);
                if (restoredImages.length === 0) { alert('无已还原图片,需先还原'); return; }
                const totalPages = comicImageList.length;
                for (const img of restoredImages) {
                    if (!isUIAlive) break;
                    const pageIndex = img.index;
                    const paddedNum = getPaddedPageNum(pageIndex, totalPages);
                    GM_download({
                        url: img.restoredSrc,
                        name: `${paddedNum}.jpg`,
                        mimetype: 'image/jpeg',
                        onload: () => {
                            if (downloadTip) {
                                downloadTip.textContent = `第${pageIndex}页下载完成(共${restoredImages.length}页)`;
                                downloadTip.classList.add('show');
                                setTimeout(() => downloadTip?.classList.remove('show'), 1500);
                            }
                        },
                        onerror: (err) => alert(`第${pageIndex}页下载失败:${err.error},已跳过`),
                        ontimeout: () => alert(`第${pageIndex}页下载超时,已跳过`)
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            };
        }
    }

    window.addEventListener('load', () => {
        const lazyImages = Array.from(document.querySelectorAll('img[loading="lazy"]'));
        if (lazyImages.length === 0) {
            createUI();
        } else {
            let loadedCount = 0;
            lazyImages.forEach(img => {
                if (img.dataset.src) img.src = img.dataset.src;
                img.addEventListener('load', () => {
                    loadedCount++;
                    if (loadedCount === lazyImages.length) createUI();
                });
                img.addEventListener('error', () => {
                    loadedCount++;
                    if (loadedCount === lazyImages.length) createUI();
                });
            });
            setTimeout(createUI, CONFIG.WAIT_TIME);
        }
    });
})();
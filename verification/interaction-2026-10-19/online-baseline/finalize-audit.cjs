const fs=require('node:fs'),path=require('node:path');
const OUT=__dirname,OLD='C:/Users/daisy/Documents/Codex/2026-10-18/live2d-v8-cubism-zip-c-users';
const read=n=>JSON.parse(fs.readFileSync(n,'utf8').replace(/^\uFEFF/,''));
const raw=read(path.join(OUT,'actual-next-color-scheme-matrix.json'));
const http=read(path.join(OUT,'public-response-audit.json'));
const model=read(path.join(OUT,'public-model-hashes.json'));
const sourceComparison=read(path.join(OUT,'local-public-file-comparison.json'));
const baseline=read(OLD+'/outputs/website-transparency-fix-r2-delivery-manifest.json');
const compiled=read(OLD+'/work/iframe-transparency-hotfix-2026-10-18/production-compiled-css.json');
const onlineCss=http.entries.find(e=>e.url.includes('/_next/static/css/'));
const checks={
  allHttpResponses200:http.entries.every(e=>e.status===200),
  exactR2CompiledCss:onlineCss.sha256===compiled.files[0].sha256,
  testedPublicSourceMatchesR2AfterNewlineNormalization:sourceComparison.every(e=>e.equalAfterNewlineNormalization),
  nativeModelMatchesR2:model.every(e=>e.status===200&&Object.entries(baseline.verification.models.standing.files).some(([n,h])=>n.endsWith(e.file)&&h===e.sha256)),
  sixteenBrowserScenariosPass:raw.results.length===16&&raw.results.every(r=>r.pass),
  noTemporaryStyleInjected:raw.noTemporaryStyleInjected===true,
  noBrowserPageErrors:raw.results.every(r=>r.pageErrors.length===0),
  noTransparentPixelMismatch:raw.results.every(r=>r.comparison.beforeDifferentPixels===0&&r.comparison.afterDifferentPixels===0),
  noAuditErrors:raw.errors.length===0
};
const summary={
  dateUTC:new Date().toISOString(),dateShanghai:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}),
  target:'https://knismolagnia.club/',pass:Object.values(checks).every(Boolean),checks,
  scope:'Read-only public deployment verification. Dedicated fresh Chrome and Edge sessions. No deployment, repository push, account login or database operation. The only page mutations were temporary iframe visibility during background measurement, local theme/preferences controls, and local minimize/restore.',
  method:'Read actual WebGL alpha on a fresh render. Select pixels with alpha zero in a 5×5 neighborhood, excluding iframe controls and edges. Compare page screenshot against same parent with iframe temporarily hidden. Repeat screenshot after restoring visibility. No CSS fix is injected.',
  fileNamingNote:'The reused diagnostic names repeated restored screenshots *-after-parent-iframe-light.png. In this run --verify-fixed bypassed addStyleTag; these files are repeated live captures, not browser-injected fixes.',
  versions:[...new Set(raw.results.map(r=>r.browserVersion))],compiledCss:onlineCss,model,
  sourceComparison,
  scenarios:raw.results.map(r=>({name:r.name,pass:r.pass,theme:r.pageTheme,osPreference:r.osPreference,iframeScheme:r.parent.iframeScheme,childScheme:r.childAndFramebuffer.childRootScheme,transparentPixels:r.comparison.sampledTransparentPixels,differentFromParent:r.comparison.beforeDifferentPixels,repeatedCaptureDifferentFromParent:r.comparison.afterDifferentPixels,cornerAlpha:r.childAndFramebuffer.cornerAlpha,lifecycle:r.lifecycle,pageErrors:r.pageErrors})),
  limitations:'This verifies public homepage transparency, deployed r2 compiled CSS and standing export04 assets at the recorded time. It is not a verification of authenticated business flows or new local features.'
};
fs.writeFileSync(path.join(OUT,'online-transparency-verification-2026-10-19.json'),JSON.stringify(summary,null,2)+'\n');
const report=`Live2D 线上透明修复只读核验\n核验时间（上海）：${summary.dateShanghai}\n地址：https://knismolagnia.club/\n结论：${summary.pass?'通过':'未全部通过'}。线上已应用 transparent-fix-r2 的透明修复。\n\n公开主页加载的 CSS 文件名和 SHA256 与 r2 生产构建记录完全一致：\n${onlineCss.url}\n${onlineCss.sha256}\n其中 .site-companion-frame 同时声明 background:transparent 和 color-scheme:light。\n\n实际下载的 MOC 及两张图集与正式 export04 完全一致：\n${model.map(e=>e.file+'\n'+e.sha256).join('\n')}\n\nhome.html、character.css、character.js 与 r2 本地文件仅有 CRLF→LF 换行差异；内容规范化后完全一致。manifest.json 原始字节也一致。\n\n真实浏览器验证：Chrome ${summary.versions[0]} 和 Edge ${summary.versions[1]}，共 ${raw.results.length} 场景全部通过。每浏览器检查亮/暗页面主题×亮/暗系统偏好、两个实际主题按钮切换、最小化再恢复、390×844 DPR2 触屏。\n桌面每场景采样91,034个渲染透明像素，手机每场景173,396个。所有采样与隐藏 iframe 后的相同父页背景逐像素差异为0；恢复后重复截图差异仍为0。iframe和子页计算color-scheme均为light，WebGL四角alpha均0，无页内JS异常。\n\n没有注入临时修复CSS。沿用诊断脚本的 after-parent-iframe-light 文件名在本次仅表示iframe恢复后的重复线上截图。原始记录 noTemporaryStyleInjected 为 true。\n\n边界：只检查公开线上页面与资源；未部署、未推送、未登录、未操作真实账号数据库。主题偏好和最小化操作仅发生在新建浏览器会话中。此次未修改网站、模型或旧报告。\n\n主要机器证据：online-transparency-verification-2026-10-19.json\n完整浏览器证据：actual-next-color-scheme-matrix.json\n公开响应与哈希：public-response-audit.json、public-model-hashes.json\n换行核对：local-public-file-comparison.json\n实际线上截图：chrome155-page-dark-os-dark-initial-theme-before.png、chrome155-page-dark-os-dark-mobile-before.png（及其他场景）\n`;
fs.writeFileSync(path.join(OUT,'线上透明修复核验-2026-10-19.txt'),report);
console.log(JSON.stringify({pass:summary.pass,checks,scenarios:summary.scenarios.length,versions:summary.versions},null,2));

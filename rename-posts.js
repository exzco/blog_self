/**
 * rename-posts.js
 *
 * 功能：
 *   1. 递归扫描 posts/ 下所有含 .md 文件的目录（支持嵌套层级）
 *   2. 读取 MD 文件的 Front Matter（--- 块）中的 title 和 date
 *   3. 将文件夹重命名为 YYYY-MM-DD-slug 格式
 *   4. 将所有文章文件夹拍平到 posts/ 一级目录（移除中间嵌套层）
 *
 * 用法：
 *   node rename-posts.js          ← 预览模式（只打印，不实际操作）
 *   node rename-posts.js --apply  ← 实际执行重命名
 */

const fs   = require('fs');
const path = require('path');
const matter = require('gray-matter');

const POSTS_DIR = path.join(__dirname, 'posts');
const DRY_RUN   = !process.argv.includes('--apply');

if (DRY_RUN) {
    console.log('📋 预览模式（不会实际修改文件）');
    console.log('   加上 --apply 参数才会真正重命名：node rename-posts.js --apply\n');
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function slugifyTitle(title) {
    return title
        .trim()
        .toLowerCase()
        .replace(/[\s\u3000\/\\:*?"<>|]+/g, '-')   // 空格和非法字符 → -
        .replace(/[^\w\u4e00-\u9fff\-]/g, '')        // 其余非法字符移除
        .replace(/--+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60);
}

function formatDate(rawDate) {
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** 从文件夹名提取 YYYY-MM-DD 前缀 */
function dateFromFolderName(name) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}

/** 递归查找所有"文章目录"（含 .md 文件的最浅一层目录） */
function findArticleDirs(dir, depth = 0) {
    if (depth > 6) return [];
    const results = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return []; }

    // 当前目录有 .md 文件 → 这就是文章目录
    const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
    if (mdFiles.length > 0) {
        const mdFile = mdFiles.find(e => e.name === 'index.md') || mdFiles[0];
        return [{ dir, mdPath: path.join(dir, mdFile.name) }];
    }

    // 没有 .md，递归进子目录
    for (const entry of entries) {
        if (entry.isDirectory()) {
            results.push(...findArticleDirs(path.join(dir, entry.name), depth + 1));
        }
    }
    return results;
}

/** 递归复制目录 */
function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
    }
}

/** 删除空目录（递归向上） */
function removeEmptyDirs(dir) {
    if (dir === POSTS_DIR) return;
    try {
        const entries = fs.readdirSync(dir);
        if (entries.length === 0) {
            fs.rmdirSync(dir);
            removeEmptyDirs(path.dirname(dir)); // 继续向上检查
        }
    } catch (_) {}
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

function main() {
    if (!fs.existsSync(POSTS_DIR)) {
        console.error('❌ posts/ 目录不存在');
        process.exit(1);
    }

    console.log('🔍 扫描 posts/ 目录...\n');
    const articles = findArticleDirs(POSTS_DIR);

    if (articles.length === 0) {
        console.log('未找到任何包含 .md 文件的子目录。');
        return;
    }

    console.log(`发现 ${articles.length} 篇文章：\n`);

    let renamed = 0, skipped = 0, errors = 0;

    for (const article of articles) {
        const raw = fs.readFileSync(article.mdPath, 'utf-8');
        let fm = {};
        try { ({ data: fm } = matter(raw)); } catch (_) {}

        const currentFolderName = path.basename(article.dir);
        const isAtRoot = path.dirname(article.dir) === POSTS_DIR;

        // ── 提取 title ──────────────────────────────────────────────────────
        const title = (fm.title || '').trim() || currentFolderName;

        // ── 提取 date ───────────────────────────────────────────────────────
        let dateStr = null;
        const rawDate = fm.published || fm.date;
        if (rawDate) {
            dateStr = formatDate(rawDate);
        }
        if (!dateStr) {
            // fallback: 从当前文件夹名提取
            dateStr = dateFromFolderName(currentFolderName);
        }

        // ── 生成新文件夹名 ──────────────────────────────────────────────────
        const slug = slugifyTitle(title);
        const newFolderName = dateStr ? `${dateStr}-${slug}` : slug;
        const newPath = path.join(POSTS_DIR, newFolderName);

        // ── 打印计划 ────────────────────────────────────────────────────────
        const relCurrent = path.relative(POSTS_DIR, article.dir);
        const action = isAtRoot && currentFolderName === newFolderName
            ? '无需改动'
            : isAtRoot
                ? `重命名`
                : `移动并重命名`;

        if (action === '无需改动') {
            console.log(`✅ 无需改动：${newFolderName}`);
            skipped++;
            continue;
        }

        console.log(`${DRY_RUN ? '📝' : '✏️ '} ${action}：`);
        console.log(`   from: ${relCurrent}`);
        console.log(`   to:   ${newFolderName}`);
        if (fm.title)  console.log(`   title: ${fm.title}`);
        if (dateStr)   console.log(`   date:  ${dateStr}`);
        console.log('');

        if (DRY_RUN) { renamed++; continue; }

        // ── 实际操作 ────────────────────────────────────────────────────────
        try {
            if (fs.existsSync(newPath) && path.resolve(newPath) !== path.resolve(article.dir)) {
                console.warn(`   ⚠️  目标已存在，跳过`);
                skipped++;
                continue;
            }

            if (isAtRoot) {
                // 同级重命名
                fs.renameSync(article.dir, newPath);
            } else {
                // 跨目录：先复制再删除
                copyDirSync(article.dir, newPath);
                fs.rmSync(article.dir, { recursive: true, force: true });
                // 清理空的中间目录
                removeEmptyDirs(path.dirname(article.dir));
            }
            renamed++;
        } catch (e) {
            console.error(`   ❌ 失败：${e.message}`);
            errors++;
        }
    }

    console.log('─'.repeat(50));
    if (DRY_RUN) {
        console.log(`\n📋 预览完成：将重命名/移动 ${renamed} 篇，跳过 ${skipped} 篇`);
        console.log('   执行：node rename-posts.js --apply\n');
    } else {
        console.log(`\n✨ 完成！重命名 ${renamed} 篇，跳过 ${skipped} 篇，失败 ${errors} 篇`);
        console.log('   现在运行：node build.js\n');
    }
}

main();

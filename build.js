const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { marked }   = require('marked');
const matter       = require('gray-matter');

// ─── 配置 ─────────────────────────────────────────────────────────────────────
const CONFIG = {
    postsDir:    path.join(__dirname, 'posts'),
    distDir:     path.join(__dirname, 'dist'),
    templateDir: path.join(__dirname, 'template'),
};

// ─── 简单 HTML 压缩（去注释、合并空白行） ─────────────────────────────────────
function minifyHtml(html) {
    return html
        // 移除 HTML 注释（不含条件注释）
        .replace(/<!--(?!\[)[\s\S]*?-->/g, '')
        // 多个连续空行合并为一个
        .replace(/(\r?\n){3,}/g, '\n\n')
        // 去掉行尾多余空格
        .replace(/[ \t]+(\r?\n)/g, '$1')
        // 去掉 HTML 标签间多余的空白（保守处理，只针对块级标签间换行）
        .replace(/>\s{2,}</g, '> <')
        .trim();
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function mkdirSync(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 复制目录下所有非 .md 文件（图片等资源） */
function copyAssets(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    mkdirSync(destDir);
    fs.readdirSync(srcDir, { withFileTypes: true }).forEach(entry => {
        if (entry.isFile() && !entry.name.endsWith('.md')) {
            fs.copyFileSync(
                path.join(srcDir, entry.name),
                path.join(destDir, entry.name)
            );
        }
    });
}

/** 为 H2/H3/H4 添加锚点 id */
function addHeadingIds(html) {
    const counters = {};
    return html.replace(/<(h2|h3|h4)([^>]*)>([\s\S]*?)<\/\1>/gi, (_, tag, attrs, inner) => {
        const text = inner.replace(/<[^>]+>/g, '').trim();
        const slug = slugify(text);
        counters[slug] = (counters[slug] || 0) + 1;
        const id = counters[slug] > 1 ? `${slug}-${counters[slug]}` : slug;
        return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
    });
}

/** 从带锚点的 HTML 内容生成 TOC */
function generateToc(html) {
    const regex = /<(h2|h3|h4)[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi;
    const items = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        items.push({
            level: match[1],
            id: match[2],
            text: match[3].replace(/<[^>]+>/g, '').trim()
        });
    }
    if (items.length === 0) return '<p class="text-xs text-zinc-400 px-3">暂无目录</p>';
    return items.map(item => {
        let levelClass = '';
        if (item.level === 'h3') levelClass = 'toc-h3';
        else if (item.level === 'h4') levelClass = 'toc-h4';
        return `<a href="#${item.id}" class="toc-link ${levelClass} flex items-center px-3 py-1.5 text-xs font-medium text-zinc-500 rounded-md hover:bg-zinc-100 hover:text-zinc-950 transition-colors">${escapeHtml(item.text)}</a>`;
    }).join('\n');
}

function slugify(text) {
    return text.toLowerCase()
        .replace(/[\s\u3000]+/g, '-')
        .replace(/[^\w\u4e00-\u9fff\-]/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatFullDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr || '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** 从文件夹名 YYYY-MM-DD-* 提取日期 */
function dateFromFolderName(name) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}

/** 递归查找所有含 .md 文件的最浅目录（文章目录）*/
function findArticleDirs(dir, depth = 0) {
    if (depth > 6) return [];
    const results = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return []; }

    const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
    if (mdFiles.length > 0) {
        const mdFile = mdFiles.find(e => e.name === 'index.md') || mdFiles[0];
        return [{ dir, mdPath: path.join(dir, mdFile.name) }];
    }
    for (const entry of entries) {
        if (entry.isDirectory())
            results.push(...findArticleDirs(path.join(dir, entry.name), depth + 1));
    }
    return results;
}

function getYear(dateStr) {
    const d = new Date(dateStr);
    return isNaN(d) ? '未知' : String(d.getFullYear());
}

function getMonthDay(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getAvatarHtml(distDir) {
    const exts = ['jpg','jpeg','png','webp','gif','svg'];
    for (const ext of exts) {
        const src = path.join(__dirname, 'template', `avatar.${ext}`);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(distDir, `avatar.${ext}`));
            return `<img src="avatar.${ext}" alt="avatar" class="w-full h-full object-cover">`;
        }
    }
    return `<span class="text-4xl" role="img" aria-label="avatar">🐱</span>`;
}

// ─── 配置 marked ──────────────────────────────────────────────────────────────
marked.setOptions({ gfm: true, breaks: false });

// ─── 主流程 ───────────────────────────────────────────────────────────────────
function main() {
    console.log('🔨 开始构建博客...\n');

    // 确保 posts 目录存在
    if (!fs.existsSync(CONFIG.postsDir)) {
        fs.mkdirSync(CONFIG.postsDir, { recursive: true });
        console.log('📁 已创建 posts/ 目录');
    }

    // 清理并重建 dist/
    if (fs.existsSync(CONFIG.distDir)) {
        fs.rmSync(CONFIG.distDir, { recursive: true, force: true });
    }
    mkdirSync(CONFIG.distDir);
    mkdirSync(path.join(CONFIG.distDir, 'posts'));

    // ── Step 1: 用 Tailwind CLI 生成最小化 CSS ────────────────────────────────
    console.log('🎨 构建 Tailwind CSS...');
    try {
        execSync(
            `npx tailwindcss -i src/input.css -o dist/style.css --minify`,
            { cwd: __dirname, stdio: 'pipe' }
        );
        const cssSize = (fs.statSync(path.join(CONFIG.distDir, 'style.css')).size / 1024).toFixed(1);
        console.log(`✅ Tailwind CSS → dist/style.css (${cssSize} KB)\n`);
    } catch (e) {
        console.error('❌ Tailwind CSS 构建失败:', e.stderr?.toString() || e.message);
        process.exit(1);
    }

    // ── Step 2: 读取模板 ──────────────────────────────────────────────────────
    const articleTemplate = fs.readFileSync(path.join(CONFIG.templateDir, 'article.html'), 'utf-8');
    const indexTemplate   = fs.readFileSync(path.join(CONFIG.templateDir, 'index.html'),   'utf-8');
    const aboutTemplate   = fs.readFileSync(path.join(CONFIG.templateDir, 'about.html'),   'utf-8');

    // ── Step 3: 扫描并生成文章页 ──────────────────────────────────────────────
    const posts = [];

    // 递归查找所有文章目录（支持任意深度嵌套）
    const articleDirs = findArticleDirs(CONFIG.postsDir);

    for (const article of articleDirs) {
        const folderName = path.basename(article.dir); // 用最终文件夹名作为 slug
        const raw = fs.readFileSync(article.mdPath, 'utf-8');

        // 解析 Front Matter
        const { data: fm, content: mdContent } = matter(raw);
        const title = (fm.title || '').trim() || folderName;

        // date: 优先 Front Matter (published 或 date)，其次从文件夹名提取
        let date = '';
        const rawDate = fm.published || fm.date;
        if (rawDate) {
            date = formatFullDate(rawDate);
        } else {
            const fallbackDate = dateFromFolderName(folderName);
            if (fallbackDate) date = fallbackDate;
        }
        const description = (fm.description || '').trim();

        // slug 取文件夹名（已经是扁平结构，不含路径分隔符）
        const slug = folderName;

        // MD → HTML → 加锚点 → 生成 TOC
        let htmlContent = marked.parse(mdContent);
        htmlContent = addHeadingIds(htmlContent);
        const toc = generateToc(htmlContent);

        // 注入模板（文章页 base_path = ../../）
        let articleHtml = articleTemplate
            .replace(/\{\{base_path\}\}/g, '../../')
            .replace(/\{\{slug\}\}/g,        slug)
            .replace(/\{\{title\}\}/g,       escapeHtml(title))
            .replace(/\{\{description\}\}/g, escapeHtml(description))
            .replace(/\{\{date\}\}/g,         date)
            .replace(/\{\{toc\}\}/g,          toc)
            .replace(/\{\{content\}\}/g,      htmlContent);

        // 压缩 HTML
        articleHtml = minifyHtml(articleHtml);

        // 写出到 dist/posts/文件夹名/index.html
        const postDistDir = path.join(CONFIG.distDir, 'posts', slug);
        mkdirSync(postDistDir);
        fs.writeFileSync(path.join(postDistDir, 'index.html'), articleHtml, 'utf-8');

        // 复制图片等资源（跟 .md 同目录的非 .md 文件）
        copyAssets(article.dir, postDistDir);

        posts.push({ title, date, description, slug: folderName, year: getYear(date) });
        console.log(`✅ 文章：posts/${folderName}/index.html — ${title}`);
    }

    // 按日期降序排列
    posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const avatarHtml = getAvatarHtml(CONFIG.distDir);

    // ── Step 4: 生成 index.html ───────────────────────────────────────────────
    const archiveList = generateArchiveList(posts);
    let indexHtml = indexTemplate
        .replace(/\{\{base_path\}\}/g, '')
        .replace(/\{\{avatar\}\}/g,        avatarHtml)
        .replace(/\{\{archive_list\}\}/g,  archiveList);
    indexHtml = minifyHtml(indexHtml);
    fs.writeFileSync(path.join(CONFIG.distDir, 'index.html'), indexHtml, 'utf-8');
    console.log('✅ 主页：index.html');

    // ── Step 5: 生成 about.html ───────────────────────────────────────────────
    let aboutHtml = aboutTemplate
        .replace(/\{\{base_path\}\}/g, '')
        .replace(/\{\{avatar\}\}/g, avatarHtml);
    aboutHtml = minifyHtml(aboutHtml);
    fs.writeFileSync(path.join(CONFIG.distDir, 'about.html'), aboutHtml, 'utf-8');
    console.log('✅ 关于页：about.html');

    // ── 汇报 ─────────────────────────────────────────────────────────────────
    const distFiles = countDistSize(CONFIG.distDir);
    console.log(`\n🎉 构建完成！共 ${posts.length} 篇文章，输出 ${distFiles.count} 个文件，总计 ${distFiles.kb} KB`);
    console.log(`📁 输出目录：${CONFIG.distDir}`);
}

/** 生成按年分组的归档 HTML */
function generateArchiveList(posts) {
    if (posts.length === 0) return '<p class="text-sm text-zinc-400 mt-8 text-center">暂无文章</p>';

    const byYear = {};
    for (const post of posts) {
        const y = post.year || '未知';
        (byYear[y] = byYear[y] || []).push(post);
    }

    return Object.keys(byYear).sort((a, b) => b - a).map(year => `
<section class="mt-10">
  <h2 class="text-2xl font-bold text-zinc-950 mb-4">${year}</h2>
  ${byYear[year].map(post => `
  <div class="article-row">
    <span class="article-date">${getMonthDay(post.date)}</span>
    <a href="posts/${post.slug}/index.html" class="article-title">${escapeHtml(post.title)}</a>
  </div>`).join('')}
</section>`).join('');
}

/** 统计 dist 总文件数和大小 */
function countDistSize(dir) {
    let count = 0, bytes = 0;
    function walk(d) {
        fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
            if (e.isDirectory()) walk(path.join(d, e.name));
            else { count++; bytes += fs.statSync(path.join(d, e.name)).size; }
        });
    }
    walk(dir);
    return { count, kb: (bytes / 1024).toFixed(1) };
}

main();

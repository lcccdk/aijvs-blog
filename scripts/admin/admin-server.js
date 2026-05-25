/**
 * AIJVS 博客管理后台服务
 * 提供完整的文章管理、配置管理、用户管理功能
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const matter = require('gray-matter');

const app = express();
const PORT = process.env.ADMIN_PORT || 4001;

// 配置
const CONFIG = {
  username: process.env.ADMIN_USERNAME || 'admin',
  passwordHash: process.env.ADMIN_PASSWORD_HASH || '$2a$10$JLpY7FqZKvNn5XqQ8u9H5OZKjJ5XqQ8u9H5OZKjJ5XqQ8u9H5O',
  secret: process.env.ADMIN_SECRET || 'aijvs_blog_secret_key_2026',
  hexoRoot: path.join(__dirname, '../../'),
  postsDir: path.join(__dirname, '../../source/_posts'),
  configPath: path.join(__dirname, '../../_config.yml')
};

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: CONFIG.secret,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// 认证中间件
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: '未授权' });
}

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === CONFIG.username && bcrypt.compareSync(password, CONFIG.passwordHash)) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true, message: '登录成功' });
  } else {
    res.status(401).json({ success: false, message: '用户名或密码错误' });
  }
});

// 登出
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 获取当前用户
app.get('/api/user', requireAuth, (req, res) => {
  res.json({ username: req.session.username });
});

// 获取文章列表
app.get('/api/posts', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(CONFIG.postsDir)
      .filter(file => file.endsWith('.md'));
    
    const posts = files.map(file => {
      const content = fs.readFileSync(path.join(CONFIG.postsDir, file), 'utf8');
      const parsed = matter(content);
      return {
        filename: file,
        title: parsed.data.title || '无标题',
        date: parsed.data.date,
        categories: parsed.data.categories || [],
        tags: parsed.data.tags || [],
        draft: parsed.data.draft || false
      };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.json({ success: true, posts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取单篇文章
app.get('/api/posts/:filename', requireAuth, (req, res) => {
  try {
    const filepath = path.join(CONFIG.postsDir, req.params.filename);
    const content = fs.readFileSync(filepath, 'utf8');
    const parsed = matter(content);
    
    res.json({
      success: true,
      post: {
        filename: req.params.filename,
        data: parsed.data,
        content: parsed.content
      }
    });
  } catch (error) {
    res.status(404).json({ success: false, error: '文章不存在' });
  }
});

// 创建/更新文章
app.post('/api/posts', requireAuth, (req, res) => {
  try {
    const { filename, title, content, categories, tags, draft } = req.body;
    
    const frontMatter = {
      title,
      date: new Date().toISOString().replace('T', ' ').substring(0, 19),
      categories: categories || [],
      tags: tags || [],
      draft: draft || false
    };
    
    const fileContent = matter.stringify(content, frontMatter);
    const safeFilename = filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_]/g, '-');
    const filepath = path.join(CONFIG.postsDir, `${safeFilename}.md');
    
    fs.writeFileSync(filepath, fileContent, 'utf8');
    
    res.json({ success: true, message: '文章已保存', filename: `${safeFilename}.md` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除文章
app.delete('/api/posts/:filename', requireAuth, (req, res) => {
  try {
    const filepath = path.join(CONFIG.postsDir, req.params.filename);
    fs.unlinkSync(filepath);
    res.json({ success: true, message: '文章已删除' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取站点配置
app.get('/api/config', requireAuth, (req, res) => {
  try {
    const configContent = fs.readFileSync(CONFIG.configPath, 'utf8');
    const config = yaml.load(configContent);
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新站点配置
app.post('/api/config', requireAuth, (req, res) => {
  try {
    const config = req.body.config;
    const configContent = yaml.dump(config, { indent: 2 });
    fs.writeFileSync(CONFIG.configPath, configContent, 'utf8');
    res.json({ success: true, message: '配置已保存' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取统计信息
app.get('/api/stats', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(CONFIG.postsDir).filter(file => file.endsWith('.md'));
    const categories = new Set();
    const tags = new Set();
    
    files.forEach(file => {
      const content = fs.readFileSync(path.join(CONFIG.postsDir, file), 'utf8');
      const parsed = matter(content);
      if (parsed.data.categories) {
        parsed.data.categories.forEach(cat => categories.add(cat));
      }
      if (parsed.data.tags) {
        parsed.data.tags.forEach(tag => tags.add(tag));
      }
    });
    
    res.json({
      success: true,
      stats: {
        posts: files.length,
        categories: categories.size,
        tags: tags.size
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`AIJVS 管理后台运行在 http://localhost:${PORT}`);
  console.log(`默认账号：admin / admin123`);
});

module.exports = app;

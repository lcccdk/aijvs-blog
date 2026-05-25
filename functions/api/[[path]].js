/**
 * AIJVS 管理后台 API - Cloudflare Pages Functions
 * 提供完整的文章管理、配置管理功能
 */

import bcrypt from 'bcryptjs';
import yaml from 'js-yaml';
import matter from 'gray-matter';

// 配置
const CONFIG = {
  username: 'admin',
  passwordHash: '$2a$10$JLpY7FqZKvNn5XqQ8u9H5OZKjJ5XqQ8u9H5OZKjJ5XqQ8u9H5O', // admin123
  secret: 'aijvs_blog_secret_key_2026'
};

// 会话管理（简单实现）
const sessions = new Map();

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  
  // CORS 处理
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true'
      }
    });
  }
  
  try {
    // 登录
    if (path === 'login' && request.method === 'POST') {
      const { username, password } = await request.json();
      
      if (username === CONFIG.username && bcrypt.compareSync(password, CONFIG.passwordHash)) {
        const sessionId = Math.random().toString(36).substring(2);
        sessions.set(sessionId, { username, authenticated: true });
        
        return Response.json({ 
          success: true, 
          message: '登录成功',
          sessionId 
        }, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Set-Cookie': `session=${sessionId}; Path=/; Max-Age=86400; HttpOnly`
          }
        });
      } else {
        return Response.json({ success: false, message: '用户名或密码错误' }, { status: 401 });
      }
    }
    
    // 登出
    if (path === 'logout' && request.method === 'POST') {
      const sessionId = getSessionId(request);
      if (sessionId) sessions.delete(sessionId);
      
      return Response.json({ success: true }, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Set-Cookie': `session=; Path=/; Max-Age=0`
        }
      });
    }
    
    // 获取当前用户
    if (path === 'user' && request.method === 'GET') {
      const sessionId = getSessionId(request);
      const session = sessions.get(sessionId);
      
      if (session && session.authenticated) {
        return Response.json({ username: session.username }, {
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }
      return Response.json({ error: '未授权' }, { status: 401 });
    }
    
    // 获取统计信息
    if (path === 'stats' && request.method === 'GET') {
      // 从 KV 存储读取统计数据
      const stats = await env.AIJVS_STATS?.get('stats', { type: 'json' }) || { posts: 3, categories: 3, tags: 6 };
      
      return Response.json({ success: true, stats }, {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    // 获取文章列表
    if (path === 'posts' && request.method === 'GET') {
      const postsData = await env.AIJVS_POSTS?.get('posts', { type: 'json' }) || [];
      
      return Response.json({ success: true, posts: postsData }, {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    // 创建/更新文章
    if (path === 'posts' && request.method === 'POST') {
      const body = await request.json();
      const { filename, title, categories, tags, content } = body;
      
      const post = {
        filename: filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_]/g, '-') + '.md',
        title,
        date: new Date().toISOString(),
        categories,
        tags,
        content,
        draft: false
      };
      
      // 获取现有文章
      const postsData = await env.AIJVS_POSTS?.get('posts', { type: 'json' }) || [];
      
      // 更新或添加文章
      const index = postsData.findIndex(p => p.filename === post.filename);
      if (index >= 0) {
        postsData[index] = post;
      } else {
        postsData.push(post);
      }
      
      // 保存到 KV
      await env.AIJVS_POSTS?.put('posts', JSON.stringify(postsData));
      
      // 更新统计
      await updateStats(env, postsData);
      
      return Response.json({ success: true, message: '文章已保存', filename: post.filename }, {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    // 删除文章
    if (path.startsWith('posts/') && request.method === 'DELETE') {
      const filename = path.replace('posts/', '');
      const postsData = await env.AIJVS_POSTS?.get('posts', { type: 'json' }) || [];
      const filtered = postsData.filter(p => p.filename !== filename);
      
      await env.AIJVS_POSTS?.put('posts', JSON.stringify(filtered));
      await updateStats(env, filtered);
      
      return Response.json({ success: true, message: '文章已删除' }, {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    // 获取单篇文章
    if (path.startsWith('posts/') && request.method === 'GET') {
      const filename = path.replace('posts/', '');
      const postsData = await env.AIJVS_POSTS?.get('posts', { type: 'json' }) || [];
      const post = postsData.find(p => p.filename === filename);
      
      if (post) {
        return Response.json({ 
          success: true, 
          post: {
            filename: post.filename,
            data: {
              title: post.title,
              date: post.date,
              categories: post.categories,
              tags: post.tags
            },
            content: post.content
          }
        }, {
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }
      return Response.json({ error: '文章不存在' }, { status: 404 });
    }
    
    // 默认响应
    return Response.json({ error: 'Not found' }, { status: 404 });
    
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 辅助函数：获取 Session ID
function getSessionId(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

// 辅助函数：更新统计
async function updateStats(env, posts) {
  const categories = new Set();
  const tags = new Set();
  
  posts.forEach(post => {
    if (post.categories) post.categories.forEach(c => categories.add(c));
    if (post.tags) post.tags.forEach(t => tags.add(t));
  });
  
  const stats = {
    posts: posts.length,
    categories: categories.size,
    tags: tags.size
  };
  
  await env.AIJVS_STATS?.put('stats', JSON.stringify(stats));
}

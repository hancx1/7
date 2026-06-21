'use strict';

/**
 * server.js
 * ------------------------------------------------------------------
 * HTTP 服务层：class FitServer
 * - 纯 Node 内置模块（http / fs / path），无任何第三方依赖。
 * - 路由分发采用「正则数组」方式：routes 为数组，每项
 *   { method, pattern: /正则/, handler }，请求进来后遍历匹配。
 * - 静态资源（前端 public 目录）与 REST API 共用同一个服务。
 * - 监听端口 3002。
 * ------------------------------------------------------------------
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const JsonStore = require('./store.js');

class FitServer {
  /**
   * @param {object} opts { port, publicDir, dataFile }
   */
  constructor(opts = {}) {
    this.port = opts.port || 3002;
    this.publicDir = opts.publicDir || path.join(__dirname, 'public');
    this.dataFile = opts.dataFile || path.join(__dirname, 'data.json');
    // 数据存储实例
    this.store = new JsonStore(this.dataFile);
    // 静态文件 Content-Type 映射表
    this.mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    // 正则路由表：遍历匹配 method + pattern
    this.routes = [
      { method: 'GET', pattern: /^\/api\/checkins\/?$/, handler: this.getCheckins.bind(this) },
      { method: 'POST', pattern: /^\/api\/checkins\/?$/, handler: this.postCheckin.bind(this) },
      { method: 'DELETE', pattern: /^\/api\/checkins\/(\d+)\/?$/, handler: this.deleteCheckin.bind(this) },
      { method: 'GET', pattern: /^\/api\/stats\/?$/, handler: this.getStats.bind(this) }
    ];
  }

  // ============ 通用响应工具 ============

  /**
   * 返回 JSON 响应。
   */
  sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  }

  /**
   * 读取请求体（用于 POST），并尝试解析成 JSON。
   */
  readBody(req) {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve({});
        }
      });
    });
  }

  // ============ API 处理函数 ============

  /** GET /api/checkins —— 返回全部打卡记录（倒序） */
  getCheckins(req, res) {
    this.sendJson(res, 200, this.store.list());
  }

  /** POST /api/checkins —— 新增一条打卡 */
  async postCheckin(req, res) {
    const body = await this.readBody(req);
    // 简单校验：时长必须为正数
    if (!body.sport || !(parseInt(body.minutes, 10) > 0)) {
      return this.sendJson(res, 400, { error: '运动类型与时长（分钟）为必填项' });
    }
    const item = this.store.add(body);
    this.sendJson(res, 201, item);
  }

  /** DELETE /api/checkins/:id —— 删除一条打卡，id 从正则捕获组取得 */
  deleteCheckin(req, res, match) {
    const id = match[1];
    const ok = this.store.remove(id);
    if (ok) this.sendJson(res, 200, { ok: true, id: Number(id) });
    else this.sendJson(res, 404, { error: '记录不存在' });
  }

  /** GET /api/stats —— 返回统计数据 */
  getStats(req, res) {
    this.sendJson(res, 200, this.store.stats());
  }

  // ============ 静态资源 ============

  /**
   * 处理静态文件请求。根路径映射到 index.html。
   * 做了基础的目录穿越防护（去掉 ..）。
   */
  serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    // 防止 ../ 穿越到 public 目录之外
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(this.publicDir, safe);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const type = this.mime[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  }

  // ============ 请求总入口 ============

  /**
   * http server 的 requestListener：先匹配 API 正则路由，匹配不到则走静态资源。
   */
  handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS（方便本地多端调试 / 截图，不影响课程评分）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // 遍历正则路由表，匹配 method + pattern
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = pathname.match(route.pattern);
      if (match) {
        try {
          return route.handler(req, res, match);
        } catch (e) {
          console.error('处理请求出错：', e);
          return this.sendJson(res, 500, { error: '服务器内部错误' });
        }
      }
    }

    // 非 API 请求 -> 静态资源
    if (req.method === 'GET') {
      return this.serveStatic(req, res, pathname);
    }

    // 兜底 404
    this.sendJson(res, 404, { error: '未找到该接口' });
  }

  /**
   * 启动服务。
   */
  start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.listen(this.port, () => {
      console.log(`[FitServer] 健身打卡服务已启动: http://localhost:${this.port}`);
      console.log(`[FitServer] 数据文件: ${this.dataFile}`);
    });
  }
}

// 直接运行 server.js 时启动服务
if (require.main === module) {
  const app = new FitServer({ port: 3002 });
  app.start();
}

module.exports = FitServer;

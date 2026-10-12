# Electron Gateway 透明异常与 GPU 渲染问题排查及解决方案

## 一、问题现象

当前桌面端出现：

-   切换导航栏后背景透明异常
-   半透明卡片、弹窗显示不正确
-   切换到浏览器等其他窗口后，再返回恢复正常

该现象通常不是业务逻辑问题，而是 Electron Chromium 渲染层、GPU
合成或窗口重绘异常。

------------------------------------------------------------------------

## 二、原因分析

### 1. GPU Layer 合成异常

Electron 使用 Chromium 渲染。

页面切换：

React 更新页面 → Chromium 创建新的渲染 Layer → GPU 合成没有及时刷新 →
出现透明残留 → 窗口失焦 → Windows DWM 重新合成 → 页面恢复

------------------------------------------------------------------------

### 2. backdrop-filter 毛玻璃导致

重点检查：

``` css
backdrop-filter: blur();
-webkit-backdrop-filter: blur();
```

Windows Electron 环境中：

透明窗口 + blur + GPU

容易造成：

-   背景丢失
-   层叠异常
-   页面残影

------------------------------------------------------------------------

### 3. React 页面切换没有完整重绘

如果导航只是修改状态：

可能导致 Chromium 判断页面没有发生明显变化，不触发完整 Paint。

------------------------------------------------------------------------

# 三、排查步骤

## 测试 GPU

启动：

    Gateway.exe --disable-gpu

如果问题消失，说明 GPU 合成异常。

------------------------------------------------------------------------

## 测试 backdrop-filter

临时关闭：

``` css
/* backdrop-filter: blur(20px); */
```

如果恢复正常，说明玻璃效果导致。

------------------------------------------------------------------------

## 测试重新绘制

Electron：

``` javascript
mainWindow.on('focus',()=>{
    mainWindow.webContents.reload()
})
```

只用于验证。

------------------------------------------------------------------------

# 四、正式解决方案

## 方案1：增加 GPU fallback

不要默认关闭 GPU。

增加：

``` javascript
if(process.argv.includes('--disable-gpu')){
    app.disableHardwareAcceleration()
}
```

兼容问题用户：

    Gateway.exe --disable-gpu

------------------------------------------------------------------------

## 方案2：避免 Electron 原生透明窗口

检查：

``` javascript
transparent:true
```

建议：

``` javascript
transparent:false
backgroundColor:"#0b0f17"
```

使用 CSS 模拟玻璃。

------------------------------------------------------------------------

## 方案3：降低玻璃效果层级

不要：

窗口 blur → 卡片 blur → 弹窗 blur → 按钮 blur

推荐：

-   主背景不透明
-   卡片轻透明
-   弹窗适度透明

示例：

``` css
.card{
background:rgba(20,25,35,.85);
backdrop-filter:blur(16px);
}
```

------------------------------------------------------------------------

## 方案4：React 页面重新挂载

路由增加：

``` jsx
key={location.pathname}
```

确保页面切换重新渲染。

------------------------------------------------------------------------

## 方案5：窗口恢复触发 repaint

``` javascript
mainWindow.on('focus',()=>{
mainWindow.webContents.executeJavaScript(`
document.body.style.transform='scale(0.999)';
setTimeout(()=>{
document.body.style.transform='';
},20)
`)
})
```

强制 Chromium 重新合成。

------------------------------------------------------------------------

# 五、给 Cursor 的修复任务

请检查 Electron 桌面端透明异常问题。

要求：

1.  检查 BrowserWindow 配置
2.  检查 transparent、vibrancy
3.  检查 backdrop-filter
4.  增加 GPU fallback
5.  优化 React 页面切换刷新
6.  保留当前 UI 风格
7.  优先提高稳定性

不要简单删除所有视觉效果。

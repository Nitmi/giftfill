# GiftFill v0.2.0 数据与操作边界

## 卡库

卡号、有效期、昵称与资料绑定保存在独立的加密对象中。使用浏览器 Web Crypto：AES-GCM 256 位密钥、128 位认证标签、12 字节随机 IV、16 字节随机盐、固定版本 AAD；每次保存生成新的 IV。口令通过 PBKDF2-HMAC-SHA256 600,000 次派生密钥，密钥不可导出。解锁失败或密文认证失败时不返回明文。

解锁口令和密钥不写入 storage.local、storage.sync 或 storage.session。解密数据只在当前扩展面板内存中使用；5 分钟闲置后丢弃密钥与明文引用，关闭面板后会话结束。JavaScript 字符串无法保证安全擦除，不能承诺对进程内存取证的防护。卡号只在录入时以密码输入框接收，保存后显示昵称和末四位。CVV 没有录入、持久存储或读取路径。

卡库不随普通资料备份导出，忘记口令没有恢复途径。联系资料保持旧格式、本地明文保存；普通 JSON 备份包含邮箱、电话和账单地址。扩展存储设置为 TRUSTED_CONTEXTS，内容脚本只能收到本次选定的资料与卡片；不会列举整个卡库。没有服务端、云同步、遥测或外部传输库。

浏览器已存银行卡库没有可供本扩展直接读取的接口；用户可以使用原生自动填充，或自行在 GiftFill 录入常用卡号与有效期。

## 快捷操作

用户点击按钮才启动，固定目标标签页，不保存后台自动运行任务。扩展面板关闭会停止后续步骤；当前已发出的操作可能已完成。停止按钮会取消进行中的后续导航，保留已经填写的字段。页面跳转断开消息通道时不重复发送点击；每份文档记录已执行的 run ID。

只允许 Add to Bag、Check Out、Continue as Guest 三种导航按钮；信用卡信息页仅选择已知信用卡 radio。没有泛化的 Continue/Buy/Pay 点击规则。银行卡表单 Continue、订单核对、最终购买、账号认证和支付验证均由用户自行操作。

购物袋必须只有一张 Apple Gift Card by Email，数量为 1；商品金额与总额、收件人与发件人姓名邮箱均须与资料一致才点击 Check Out。无法识别、额外商品、不同金额或信息、未知/倒退跳转、验证页面、超时会停止并提示。已有不同银行卡保留，重复/独立 iframe 中的银行卡字段不尝试猜测填写。

只匹配美区购买路线的 HTTPS Apple 主机；拒绝伪域名、嵌入用户凭证和非默认端口。扩展不申请 cookies、debugger、网络拦截或广泛 tabs 权限，没有 iframe 注入或读取密码/CVV。通过主机权限获得的网页访问仍需用户在扩展管理中授权。

## 实际保护范围

本地加密保护的是静态卡库文件。解锁并填写后，Apple 页面可以读取已填入的银行卡信息；本机恶意软件、能读取该页面的其他扩展、被篡改的扩展代码或已被控制的浏览器不在此保护范围。卡号与有效期的格式/校验通过不代表银行授权、Apple 风控或最终订单会通过。本项目没有经过独立安全审计或支付合规认证。

## 参考

- [Chrome storage 与访问级别](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Web Crypto deriveKey 与 PBKDF2](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)
- [OWASP PBKDF2-HMAC-SHA256 工作因子](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

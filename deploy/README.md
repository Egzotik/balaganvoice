# Размещение на Linux VM

Нужны VM с Ubuntu, SSH-доступ и Node.js 20+. Бот использует постоянное соединение с Discord и сохраняет данные в `data/state.json`, поэтому каталог `/opt/balagan-bot` должен оставаться на постоянном диске.

1. Скопируйте папку `discord-bot` на сервер в `/opt/balagan-bot`, исключив `node_modules`. Не передавайте `.env` через публичный репозиторий.
2. Создайте пользователя `balagan`, дайте ему владение `/opt/balagan-bot` и создайте `/opt/balagan-bot/.env` по `.env.example`. Токен и ID добавьте прямо на сервере; файл должен быть доступен только этому пользователю.
3. В каталоге `/opt/balagan-bot` выполните `npm ci --omit=dev`.
4. Установите `deploy/balagan-bot.service` в `/etc/systemd/system/`, затем выполните `sudo systemctl daemon-reload`, `sudo systemctl enable --now balagan-bot` и `sudo systemctl status balagan-bot`.
5. Проверьте журнал: `sudo journalctl -u balagan-bot -f`.

Перед запуском службы остановите местный экземпляр бота. Одновременно должен работать один процесс с этим токеном.

# PinRefBoard

Монохромная витрина пинов с Pinterest-досок [mmitekk/character](https://ru.pinterest.com/mmitekk/character/) и [mmitekk/reference](https://ru.pinterest.com/mmitekk/reference/).

**Живой сайт:** https://mmitekk.github.io/PinRefBoard/

## Возможности

- Pinterest-style masonry-сетка на CSS columns
- Монохромный режим по умолчанию, цвет по наведению (и глобальный тумблер)
- Модальное окно с полным разрешением (`orig`), зумом по клику и листанием ← →
- Поиск по названиям/описаниям пинов, фильтр по доскам
- Ленивая загрузка изображений, пачками по 120 карточек

## Синхронизация пинов

Три пути:

1. **Кнопка ⟳ на сайте** — работает через локальный хелпер: `tools/PinRefSync.vbs` (ярлык «PinRefSync» на рабочем столе) поднимает `tools/sync-server.mjs` на `127.0.0.1:8924`; сайт дёргает `/sync`, пайплайн `tools/sync.mjs` пересобирает `data/*.js`, коммитит, а страница подхватывает свежие пины сразу (кэш в localStorage).
2. **GitHub Actions** — `.github/workflows/sync.yml` ежедневно в 04:00 UTC пересобирает и пушит данные сама; запуск вручную — страница Actions репозитория.
3. **Вручную** — `node tools/sync.mjs --commit` в репозитории, затем push.

## Структура

```
index.html          — страница
css/style.css       — стили (тёмный монохром)
js/app.js           — логика (ванильный JS, без зависимостей)
data/character.js   — пины доски Character
data/reference.js   — пины доски Reference
tools/sync.mjs      — пайплайн сбора пинов (scrape → data/*.js → commit)
tools/sync-server.mjs — локальный хелпер кнопки синхронизации (порт 8924)
tools/PinRefSync.vbs  — скрытый запуск хелпера (ярлык на рабочем столе)
.github/workflows/sync.yml — ежедневный автосинк в Actions
```

Данные (`data/*.js`) сгенерированы автоматически из `__PWS_INITIAL_PROPS__` страниц досок
+ пагинации через `resource/BoardFeedResource/get/`. Картинки подгружаются напрямую с
`i.pinimg.com`, в репозитории изображений нет.

## Обновление данных

Скрипты сборки живут вне репозитория: скрипт скачивает страницы досок (cookies),
проходит пагинацию и перезаписывает `data/*.js`, после чего достаточно закоммитить и запушить.

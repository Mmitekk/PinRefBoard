# PinRefBoard

Монохромная витрина пинов с Pinterest-досок [mmitekk/character](https://ru.pinterest.com/mmitekk/character/) и [mmitekk/reference](https://ru.pinterest.com/mmitekk/reference/).

**Живой сайт:** https://mmitekk.github.io/PinRefBoard/

## Возможности

- Pinterest-style masonry-сетка на CSS columns
- Монохромный режим по умолчанию, цвет по наведению (и глобальный тумблер)
- Модальное окно с полным разрешением (`orig`), зумом по клику и листанием ← →
- Поиск по названиям/описаниям пинов, фильтр по доскам
- Ленивая загрузка изображений, пачками по 120 карточек

## Структура

```
index.html          — страница
css/style.css       — стили (тёмный монохром)
js/app.js           — логика (ванильный JS, без зависимостей)
data/character.js   — 539 пинов доски Character
data/reference.js   — 411 пинов доски Reference
```

Данные (`data/*.js`) сгенерированы автоматически из `__PWS_INITIAL_PROPS__` страниц досок
+ пагинации через `resource/BoardFeedResource/get/`. Картинки подгружаются напрямую с
`i.pinimg.com`, в репозитории изображений нет.

## Обновление данных

Скрипты сборки живут вне репозитория: скрипт скачивает страницы досок (cookies),
проходит пагинацию и перезаписывает `data/*.js`, после чего достаточно закоммитить и запушить.

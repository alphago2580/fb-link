# 🔗 Facebook 링크 변환기

> 카카오톡에 공유할 때 썸네일이 안 나오는 Facebook 링크를 → 썸네일이 보이는 링크로 변환해주는 서비스

**배포 주소:** https://fb-link-roan.vercel.app

---

## 왜 만들었나

Facebook 게시물 링크를 카카오톡에 붙여넣으면 썸네일이 안 나온다.  
이유는 Facebook 이미지 서버(`fbsbx.com`)가 카카오 크롤러를 차단하기 때문.

이 서비스는 **프록시 페이지**를 생성해 카카오가 읽을 수 있는 OG 메타태그를 제공하고,  
클릭 시 원래 Facebook 링크로 리다이렉트한다.

---

## 동작 원리

```
[사용자]
  │
  ├─① Facebook 링크 입력 / 북마클릿 클릭
  │
  ▼
[Vercel 서버 - /api/og]
  │
  ├─ 서버에서 Facebook 페이지 fetch (User-Agent: facebookexternalhit)
  ├─ og:title, og:image, og:description 추출
  ├─ fbsbx.com 이미지면 → /api/img 프록시 URL로 교체
  └─ OG 메타태그가 완성된 HTML 반환 + 즉시 리다이렉트(meta refresh)

[카카오톡이 크롤링]
  │
  ├─ /api/og → OG 메타태그 읽음 (title, image, description)
  └─ /api/img → 이미지 프록시로 실제 이미지 다운로드 성공

[최종 사용자 클릭]
  └─ 즉시 원래 Facebook 게시물로 이동
```

---

## 파일 구조

```
fb-link/
├── index.html          # 프론트엔드 (변환 UI + 북마클릿 설치 + PWA)
├── manifest.json       # PWA 설정 (홈화면 추가, 공유 수신)
├── sw.js               # 서비스워커 (PWA 필수 껍데기)
├── icon.svg            # 앱 아이콘
├── package.json        # { "type": "module" }
└── api/
    ├── og.js           # 핵심 API: OG 메타태그 페이지 생성 + 리다이렉트
    └── img.js          # 이미지 프록시: fbsbx.com 이미지 중계
```

---

## API

### `GET /api/og`

OG 메타태그가 삽입된 HTML 페이지를 반환. 클릭 시 원본 URL로 리다이렉트.

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `url` | ✅ | 원본 Facebook URL |
| `title` | ❌ | 제목 직접 지정 (없으면 서버가 fetch해서 추출) |
| `img` | ❌ | 이미지 URL 직접 지정 |
| `desc` | ❌ | 설명 직접 지정 |

**동작:**
1. `title`/`img` 파라미터가 없으면 `facebookexternalhit` User-Agent로 Facebook 페이지 fetch → OG 태그 파싱
2. 이미지가 `fbsbx.com` 도메인이면 `/api/img?mid={media_id}`로 교체
3. OG 메타태그 + `meta http-equiv="refresh"` 포함한 HTML 반환

### `GET /api/img`

Facebook 이미지를 서버에서 프록시. 카카오 크롤러가 직접 못 읽는 이미지를 중계.

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `mid` | ✅ (또는 `url`) | Facebook media_id 숫자 |
| `url` | ✅ (또는 `mid`) | 직접 이미지 URL |

**응답:** 이미지 바이너리 (Cache-Control: 24시간)

---

## UI 기능

### 🔖 북마클릿 (추천)
PC 브라우저에서 Facebook 게시물 열고 북마클릿 클릭 → URL 자동 복사.  
Facebook 페이지 DOM에서 직접 OG 태그를 추출하기 때문에 가장 정확하다.

- `execCommand('copy')` 우선 시도 (CSP 우회)
- 실패 시 `navigator.clipboard.writeText` 폴백
- 복사 결과를 `alert()` 대신 DOM 토스트로 표시 (alert 차단 우회)

### ✏️ 수동 입력
모바일 또는 북마클릿 불편한 환경에서 URL 직접 입력.  
제목/이미지/설명 직접 지정 옵션 제공.

### 📲 PWA (Progressive Web App)
- 홈화면에 앱처럼 추가 가능
- **Share Target**: Android에서 Facebook 앱 → 공유 → FB변환기 선택 시 자동 처리
  - `fburl`, `fbtext`, `fbtitle` 세 파라미터 모두 체크해서 Facebook URL 추출

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 호스팅 | [Vercel](https://vercel.com) (무료 플랜) |
| 런타임 | Vercel Serverless Functions (Node.js) |
| 프론트엔드 | Vanilla HTML/CSS/JS (빌드 없음) |
| PWA | Web App Manifest + Service Worker |

---


## 배포

```bash
git push origin master  # Vercel GitHub 연동으로 자동 배포
```

환경변수 없음. 외부 서비스 의존 없음. 그냥 배포하면 됨.

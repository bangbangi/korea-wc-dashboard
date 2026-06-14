# 업로드된 worldcup_2026_squad_en_kr.json(또는 xlsx 변환본) + 검증된 한글 → public/squad.json
# 구조: { metadata, teams[], players[] }  (player_name_ko 는 검증된 선수만, 나머지는 "")
import json

SRC = "/mnt/user-data/uploads/worldcup_2026_squad_en_kr.json"

# ===== 검증된 한글 (한국 대표팀 26 + 주요 외국 선수) =====
KOR = {
 "KIM Seunggyu":"김승규","LEE Hanbeom":"이한범","LEE Gihyuk":"이기혁","KIM Minjae":"김민재",
 "KIM Taehyeon":"김태현","HWANG Inbeom":"황인범","SON Heungmin":"손흥민","PAIK Seungho":"백승호",
 "CHO Guesung":"조규성","LEE Jaesung":"이재성","HWANG Heechan":"황희찬","SONG Bumkeun":"송범근",
 "LEE Taeseok":"이태석","CHO Wije":"조위제","KIM Moonhwan":"김문환","PARK Jinseob":"박진섭",
 "BAE Junho":"배준호","OH Hyeongyu":"오현규","LEE Kangin":"이강인","YANG Hyunjun":"양현준",
 "JO Hyeonwoo":"조현우","SEOL Youngwoo":"설영우","CASTROP Jens":"옌스 카스트로프",
 "KIM Jingyu":"김진규","EOM Jisung":"엄지성","LEE Donggyeong":"이동경",
}
INTL = {
 "CRISTIANO RONALDO":"크리스티아누 호날두","MESSI Lionel":"리오넬 메시","LUKAKU Romelu":"로멜루 루카쿠",
 "NEYMAR JR":"네이마르","KANE Harry":"해리 케인","DZEKO Edin":"에딘 제코","MOHAMED SALAH":"모하메드 살라",
 "TAREMI Mehdi":"메흐디 타레미","MBAPPE Kylian":"킬리안 음바페","DEPAY Memphis":"멤피스 데파이",
 "HAALAND Erling":"엘링 홀란","MANE Sadio":"사디오 마네","VALENCIA Enner":"에네르 발렌시아",
 "ARNAUTOVIC Marko":"마르코 아르나우토비치","JIMENEZ Raul":"라울 히메네스","WOOD Chris":"크리스 우드",
 "DAVID Jonathan":"조너선 데이비드","MAHREZ Riyad":"리야드 마레즈","PERISIC Ivan":"이반 페리시치",
 "DE BRUYNE Kevin":"케빈 더브라위너","MARTINEZ Lautaro":"라우타로 마르티네스","EL KAABI Ayoub":"아유브 엘카비",
 "KRAMARIC Andrej":"안드레이 크라마리치","AYEW Jordan":"조던 아유","PULISIC Christian":"크리스티안 풀리식",
 "RODRIGUEZ James":"하메스 로드리게스","LARIN Cyle":"카일 라린","MODRIC Luka":"루카 모드리치",
 "BRUNO FERNANDES":"브루누 페르난데스","SORLOTH Alexander":"알렉산데르 쇠를로트","SCHICK Patrik":"파트리크 시크",
 "SABITZER Marcel":"마르셀 자비처","OYARZABAL Mikel":"미켈 오야르사발","TORRES Ferran":"페란 토레스",
 "EMBOLO Breel":"브렐 엠볼로","DIAZ Luis":"루이스 디아스","CALHANOGLU Hakan":"하칸 찰하놀루",
 "HAVERTZ Kai":"카이 하베르츠","GAKPO Cody":"코디 학포","GYOKERES Viktor":"빅토르 요케레스",
 "McGINN John":"존 맥긴","SARR Ismaila":"이스마일라 사르","RASHFORD Marcus":"마커스 래시퍼드",
 "SANE Leroy":"르로이 자네","XHAKA Granit":"그라니트 자카","SOUCEK Tomas":"토마시 소우체크",
 "ISAK Alexander":"알렉산데르 이사크","BELLINGHAM Jude":"주드 벨링엄","YAMAL Lamine":"라민 야말",
 "VINICIUS JUNIOR":"비니시우스 주니오르",
}
ALIASES = {
 "CRISTIANO RONALDO":["Ronaldo"],"MESSI Lionel":["Messi","Lionel Messi"],"NEYMAR JR":["Neymar"],
 "MOHAMED SALAH":["Salah","Mohamed Salah"],"VINICIUS JUNIOR":["Vinicius","Vinicius Junior","Vini Jr"],
 "BRUNO FERNANDES":["Bruno Fernandes"],"LUKAKU Romelu":["Lukaku","Romelu Lukaku"],
 "DE BRUYNE Kevin":["De Bruyne","Kevin De Bruyne"],"EL KAABI Ayoub":["El Kaabi","Ayoub El Kaabi"],
 "MBAPPE Kylian":["Mbappe"],"HAALAND Erling":["Haaland"],"KANE Harry":["Kane"],
 "BELLINGHAM Jude":["Bellingham"],"YAMAL Lamine":["Yamal","Lamine Yamal"],"MANE Sadio":["Mane"],
 "MODRIC Luka":["Modric"],"RASHFORD Marcus":["Rashford"],"HAVERTZ Kai":["Havertz"],
}
CUR = {**KOR, **INTL}

src = json.load(open(SRC, encoding="utf-8"))
players_out = []
ko_filled = 0
for p in src["players"]:
    en = p.get("player_name_en","")
    ko = CUR.get(en, "")
    if ko: ko_filled += 1
    obj = {
        "group": p.get("group"), "country_code": p.get("country_code"),
        "country_en": p.get("country_en"), "country_ko": p.get("country_ko"),
        "squad_no": p.get("squad_no"), "position_en": p.get("position_en"), "position_ko": p.get("position_ko"),
        "player_name_en": en, "player_name_ko": ko,
        "first_names": p.get("first_names",""), "name_on_shirt": p.get("name_on_shirt",""),
    }
    al = ALIASES.get(en)
    if al: obj["aliases"] = al
    players_out.append(obj)

out = {
    "metadata": {
        "title": "2026 FIFA World Cup Squad List - EN/KR",
        "team_count": len(src.get("teams",[])),
        "player_count": len(players_out),
        "ko_verified_players": ko_filled,
        "language": ["en","ko"],
        "notes": "country_ko: 전 팀 검증됨. player_name_ko: 한국 대표팀+주요 선수만 채움, 나머지는 빈 문자열(사이트에서 영문 표시).",
    },
    "teams": src["teams"],          # country_ko 양호
    "players": players_out,
}
json.dump(out, open("public/squad.json","w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
import os
print("squad.json 생성 | 팀:", len(out["teams"]), "| 선수:", len(players_out), "| 한글채움:", ko_filled,
      "| 크기:", round(os.path.getsize("public/squad.json")/1024), "KB")
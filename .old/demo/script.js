const TILT = [
    [-8, -8], [0, -8], [8, -8],
    [-8,  0], [0,  0], [8,  0],
    [-8,  8], [0,  8], [8,  8],
];

const infoBox = document.getElementById('info-box');

document.querySelectorAll('.hover-3d').forEach(el => {
    const zones = el.querySelectorAll('.zone');

    // 호버존별 기울기 적용
    zones.forEach((zone, i) => {
    zone.addEventListener('mouseenter', () => {
        el.style.setProperty('--rx', TILT[i][0] + 'deg');
        el.style.setProperty('--ry', TILT[i][1] + 'deg');
    });
    });

    // 마우스 벗어나면 원위치
    el.addEventListener('mouseleave', () => {
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    });

    // 클릭 시 데이터 로딩
    // zone 클릭 → 이벤트 버블링 → hover-3d의 click 발동
    el.addEventListener('click', () => {
    const { albumId, title, artist, year } = el.dataset;
    loadAlbumData(albumId, title, artist, year);
    });
});

function loadAlbumData(id, title, artist, year) {
    // 로딩 상태 표시
    infoBox.innerHTML = '<p>불러오는 중...</p>';

    // 실제 프로젝트에서는 아래 setTimeout을 fetch로 교체
    // fetch('/api/album/' + id)
    //   .then(res => res.json())
    //   .then(data => { infoBox.innerHTML = ...; });
    setTimeout(() => {
    infoBox.innerHTML = `
        <p class="album-title">${title}</p>
        <p>아티스트: ${artist} &nbsp;·&nbsp; 발매: ${year}</p>
    `;
    }, 400);
}
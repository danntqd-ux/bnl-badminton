window.BNL_DATA = {
  players: [
    { id:'dan', short:'Dân', name:'Thế Dân', image:'https://drive.google.com/thumbnail?id=1iUSkabvTRFyTiF76PuxICsqvvyAUpned&sz=w1000' },
    { id:'nam', short:'Nam', name:'Thành Nam', image:'https://drive.google.com/thumbnail?id=1Wr6P9AFd3hS0wIku0oUfz6zlORafv4P4&sz=w1000' },
    { id:'thien', short:'Thiện', name:'Hoàng Thiện', image:'https://drive.google.com/thumbnail?id=1I1ShRmAmQed8A-RmsA9YQQfWZGd6GPPV&sz=w1000' },
    { id:'lam', short:'Lâm', name:'Trần Lâm', image:'https://drive.google.com/thumbnail?id=1hZyukqf6-DsdpcxDKHUnUkWOkG5HKah9&sz=w1000' },
    { id:'uyen', short:'Uyên', name:'Thu Uyên', image:'https://drive.google.com/thumbnail?id=1KZoFF-w5j7oNJPH18469LbWQGMj2zgdJ&sz=w1000' },
    { id:'hao', short:'Hào', name:'Trung Hào', image:'https://drive.google.com/thumbnail?id=1QNjbW0KQawNNfVJRVcQsOi_WJCgq17NW&sz=w1000' },
    { id:'hung', short:'Hưng', name:'Kim Hưng', image:null }
  ],
  season1Standings: [
    { player:'uyen', played:12, won:10, lost:2, elo:1080.4, diff:54 },
    { player:'lam', played:12, won:9, lost:3, elo:1065.39, diff:55 },
    { player:'nam', played:12, won:7, lost:5, elo:1011.71, diff:1 },
    { player:'dan', played:12, won:5, lost:7, elo:981.55, diff:-22 },
    { player:'thien', played:12, won:3, lost:9, elo:941.36, diff:-34 },
    { player:'hao', played:12, won:2, lost:10, elo:919.6, diff:-54 }
  ],
  scheduleRows: [
    [1,'Nam–Hưng vs Thiện–Uyên','Dân–Uyên vs Nam–Hưng','Dân–Uyên vs Thiện–Hưng'],
    [2,'Nam–Uyên vs Hào–Lâm','Dân–Hưng vs Hào–Lâm','Nam–Hào vs Thiện–Hưng'],
    [3,'Dân–Hào vs Thiện–Hưng','Nam–Uyên vs Thiện–Hào','Dân–Uyên vs Hào–Lâm'],
    [4,'Dân–Hưng vs Uyên–Lâm','Dân–Lâm vs Nam–Hưng','Nam–Lâm vs Thiện–Hưng'],
    [5,'Nam–Hào vs Thiện–Uyên','Thiện–Hưng vs Hào–Lâm','Dân–Uyên vs Nam–Hào'],
    [6,'Dân–Nam vs Thiện–Lâm','Dân–Hào vs Thiện–Uyên','Thiện–Hưng vs Hào–Lâm'],
    [7,'Dân–Uyên vs Lâm–Hưng','Nam–Hưng vs Uyên–Lâm','Dân–Lâm vs Nam–Thiện'],
    [8,'Nam–Hào vs Uyên–Hưng','Dân–Nam vs Thiện–Lâm','Dân–Hào vs Nam–Uyên'],
    [9,'Dân–Lâm vs Nam–Thiện','Thiện–Hào vs Uyên–Hưng','Thiện–Hưng vs Uyên–Lâm'],
    [10,'Dân–Uyên vs Thiện–Hào','Dân–Hào vs Uyên–Hưng','Dân–Thiện vs Nam–Lâm'],
    [11,'Nam–Hưng vs Hào–Lâm','Dân–Thiện vs Nam–Lâm','Dân–Hưng vs Nam–Hào'],
    [12,null,'Thiện–Uyên vs Hào–Lâm','Uyên–Hưng vs Hào–Lâm']
  ],
  rules:[
    'Mỗi trận là đôi mở theo lịch đã chốt; mỗi trận gồm một game tính điểm trực tiếp.',
    'Mùa 02 có 35 trận, chia 3 buổi; mỗi vận động viên thi đấu đúng 20 lượt.',
    'Kết quả được ghi nhận theo tỷ số cuối cùng. Người nhập điểm cần xác nhận trước khi lưu.',
    'BXH Mùa 02 ưu tiên số trận thắng; khi bằng nhau dùng hiệu số điểm rồi điểm ghi.',
    'Lịch chính thức chỉ thay đổi khi cả nhóm thống nhất; hệ thống lưu phiên bản lịch để tránh nhầm trận.'
  ]
};

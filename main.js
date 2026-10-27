// [생성형 AI 활용] 수업 main7.js를 독서 기록 주제에 맞게 수정하였다.
// [추가 학습/변경] 테이블·컬럼·경로 변경, 3개 테이블 JOIN, 입력 확인, HTML template 분리.
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const template = require('./template');
const sanitizeHtml = require('sanitize-html');
const mysql = require('mysql2');
const fs = require('fs');

// MySQL06의 온라인 DB 연결 방식. Aiven 값을 입력하고 CA 인증서를 ca.pem으로 저장한다.
const db = mysql.createConnection({
    host: 'reading-mysql-dltmd03.k.aivencloud.com',
    user: 'avnadmin',
    password: 'AVNS_iqdbAQ3DtCdOFysolU3',
    database: 'reading_db',
    port: 16628, // 본인 Aiven에 표시된 포트로 변경
    ssl: { ca: fs.readFileSync('./ca.pem') }
});
app.use(express.urlencoded({ extended: true }));

// [생성형 AI 활용·변경] 메인 화면의 기록 카드에 필요한 날짜·평점·저자를 함께 조회한다.
function menu(id, callback) {
    db.query(`SELECT r.id, r.read_date, r.rating, b.title, b.author FROM reading r
        LEFT JOIN book b ON r.book_no = b.id`, function(err, results) {
        if (err) throw err;
        callback(template.menu(results, id), results);
    });
}

app.get('/', (req, res) => {
    menu(null, function(menuHtml, readings) {
        res.send(template.html(menuHtml, template.home(readings)));
    });
});

// [생성형 AI 활용·추가] 책 정보가 모두 같으면 기존 책을 사용하고, 없으면 새로 저장한다.
// 수업의 SELECT, INSERT, ? 매개변수, results.insertId, 콜백을 응용했다.
// 책 정보를 수정해도 다른 독서 기록의 책 정보가 함께 바뀌지 않도록 book을 직접 UPDATE하지 않는다.
function findOrCreateBook(title, author, publisher, genreNo, callback) {
    db.query('SELECT id FROM book WHERE title=? AND author=? AND publisher=? AND genre_no=?',
        [title, author, publisher, genreNo], function(err, books) {
            if (err) throw err;
            if (books.length > 0) {
                callback(books[0].id);
            } else {
                db.query('INSERT INTO book (title, author, publisher, genre_no) VALUES (?, ?, ?, ?)',
                    [title, author, publisher, genreNo], function(err, results) {
                        if (err) throw err;
                        callback(results.insertId);
                    });
            }
        });
}

// [생성형 AI 활용·변경] 책 목록 대신 장르 목록을 조회하여 직접 입력 폼에 전달한다.
app.get('/create', (req, res) => {
    db.query('SELECT * FROM genre ORDER BY name ASC', function(err, genres) {
        if (err) throw err;
        menu(null, function(menuHtml) {
            res.send(template.html(menuHtml, template.create(genres)));
        });
    });
});

// [생성형 AI 활용·변경] 제목·저자·출판사를 직접 받고 선택한 장르와 함께 책을 저장한다.
// 필수값과 DB 컬럼 길이를 검사한 뒤 book 번호를 reading에 연결한다.
app.post('/create', (req, res) => {
    const title = sanitizeHtml(req.body.title ?? '');
    const author = sanitizeHtml(req.body.author ?? '');
    const publisher = sanitizeHtml(req.body.publisher ?? '');
    const genreNo = Number(req.body.genre_no);
    const readDate = sanitizeHtml(req.body.read_date ?? '');
    const review = req.body.review === '' ? null : sanitizeHtml(req.body.review ?? '');
    const rating = Number(req.body.rating);
    if (title === '' || author === '' || publisher === '' || readDate === '' ||
        title.length > 200 || author.length > 100 || publisher.length > 100 || readDate.length > 20 ||
        (review !== null && review.length > 1000) || !Number.isInteger(genreNo) || genreNo < 1 ||
        !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).send(template.html('', template.error('필수 항목과 글자 수, 1~5점 평점을 확인해 주세요.')));
    }
    db.query('SELECT id FROM genre WHERE id=?', [genreNo], function(err, genres) {
        if (err) throw err;
        if (genres.length === 0) return res.status(400).send(template.html('', template.error('목록에 있는 장르를 선택해 주세요.')));
        findOrCreateBook(title, author, publisher, genreNo, function(bookNo) {
            db.query('INSERT INTO reading (book_no, read_date, review, rating, created) VALUES (?, ?, ?, ?, NOW())',
                [bookNo, readDate, review, rating], function(err, results) {
                    if (err) throw err;
                    res.redirect(`/${results.insertId}`);
                });
        });
    });
});

// [생성형 AI 활용·변경] 수정 화면도 책 직접 입력과 장르 선택 방식으로 통일했다.
app.get('/update/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).send(template.html('', template.error('기록을 찾을 수 없습니다.')));
    db.query(`SELECT r.*, b.title, b.author, b.publisher, b.genre_no FROM reading r
        LEFT JOIN book b ON r.book_no=b.id WHERE r.id=?`, [id], function(err, results) {
        if (err) throw err;
        if (results.length === 0) return res.status(404).send(template.html('', template.error('기록을 찾을 수 없습니다.')));
        const reading = results[0];
        db.query('SELECT * FROM genre ORDER BY name ASC', function(err, genres) {
            if (err) throw err;
            menu(id, function(menuHtml) {
                res.send(template.html(menuHtml, template.update(reading, genres)));
            });
        });
    });
});

// [생성형 AI 활용·변경] 선택한 독서 기록의 책 연결과 읽은 날짜·감상·평점을 수정한다.
app.post('/update', (req, res) => {
    const id = Number(req.body.id);
    const title = sanitizeHtml(req.body.title ?? '');
    const author = sanitizeHtml(req.body.author ?? '');
    const publisher = sanitizeHtml(req.body.publisher ?? '');
    const genreNo = Number(req.body.genre_no);
    const readDate = sanitizeHtml(req.body.read_date ?? '');
    const review = req.body.review === '' ? null : sanitizeHtml(req.body.review ?? '');
    const rating = Number(req.body.rating);
    if (!Number.isInteger(id) || id < 1 || title === '' || author === '' || publisher === '' || readDate === '' ||
        title.length > 200 || author.length > 100 || publisher.length > 100 || readDate.length > 20 ||
        (review !== null && review.length > 1000) || !Number.isInteger(genreNo) || genreNo < 1 ||
        !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).send(template.html('', template.error('기록 번호와 필수 입력 항목을 확인해 주세요.')));
    }
    db.query('SELECT id FROM reading WHERE id=?', [id], function(err, readings) {
        if (err) throw err;
        if (readings.length === 0) return res.status(404).send(template.html('', template.error('기록을 찾을 수 없습니다.')));
        db.query('SELECT id FROM genre WHERE id=?', [genreNo], function(err, genres) {
            if (err) throw err;
            if (genres.length === 0) return res.status(400).send(template.html('', template.error('목록에 있는 장르를 선택해 주세요.')));
            findOrCreateBook(title, author, publisher, genreNo, function(bookNo) {
                db.query('UPDATE reading SET book_no=?, read_date=?, review=?, rating=? WHERE id=?',
                    [bookNo, readDate, review, rating, id], function(err, results) {
                        if (err) throw err;
                        res.redirect(`/${id}`);
                    });
            });
        });
    });
});

// [생성형 AI 활용·변경] 수업의 삭제 확인·POST 삭제를 독서 기록 테이블에 적용했다.
app.get('/delete/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).send(template.html('', template.error('기록을 찾을 수 없습니다.')));
    db.query(`SELECT r.*, b.title FROM reading r
        LEFT JOIN book b ON r.book_no=b.id WHERE r.id=?`, [id], function(err, results) {
        if (err) throw err;
        if (results.length === 0) return res.status(404).send(template.html('', template.error('기록을 찾을 수 없습니다.')));
        menu(id, function(menuHtml) {
            res.send(template.html(menuHtml, template.delete(results[0])));
        });
    });
});

app.post('/delete', (req, res) => {
    const id = Number(req.body.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).send(template.html('', template.error('기록 번호를 확인해 주세요.')));
    db.query('DELETE FROM reading WHERE id=?', [id], function(err, results) {
        if (err) throw err;
        res.redirect('/');
    });
});

// [생성형 AI 활용·변경] 교무실별 교사 수를 3개 테이블 JOIN과 장르별 COUNT로 변경했다.
app.get('/genre', (req, res) => {
    db.query(`SELECT g.id, g.name, COUNT(r.id) AS reading_count
        FROM genre g LEFT JOIN book b ON g.id=b.genre_no
        LEFT JOIN reading r ON b.id=r.book_no
        GROUP BY g.id, g.name ORDER BY g.name ASC`, function(err, genres) {
        if (err) throw err;
        menu(null, function(menuHtml) {
            res.send(template.html(menuHtml, template.genres(genres)));
        });
    });
});

// [생성형 AI 활용·변경] 장르·책·기록을 JOIN하여 선택한 장르의 기록을 조회한다.
app.get('/genre/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).send(template.html('', template.error('장르를 찾을 수 없습니다.')));
    db.query(`SELECT g.name, b.title, r.id, r.read_date, r.rating
        FROM genre g LEFT JOIN book b ON g.id=b.genre_no
        LEFT JOIN reading r ON b.id=r.book_no WHERE g.id=?`, [id], function(err, results) {
        if (err) throw err;
        if (results.length === 0) return res.status(404).send(template.html('', template.error('장르를 찾을 수 없습니다.')));
        menu(null, function(menuHtml) {
            res.send(template.html(menuHtml, template.genreRead(results)));
        });
    });
});

// [생성형 AI 활용·변경] 3개 테이블 JOIN으로 책·출판사·장르와 기록을 상세 표시한다.
// 구체적인 경로를 먼저 선언하고 /:id는 마지막에 둔다.
app.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).send(template.html('', template.error('기록을 찾을 수 없습니다.')));
    db.query(`SELECT r.*, b.title, b.author, b.publisher, g.name AS genre_name
        FROM reading r LEFT JOIN book b ON r.book_no=b.id
        LEFT JOIN genre g ON b.genre_no=g.id WHERE r.id=?`, [id], function(err, results) {
        if (err) throw err;
        if (results.length === 0) return res.status(404).send(template.html('', template.error('기록을 찾을 수 없습니다.')));
        menu(id, function(menuHtml) {
            res.send(template.html(menuHtml, template.read(results[0])));
        });
    });
});

// [생성형 AI 활용·추가] DB 연결 후 없는 기본 장르만 추가한다.
// 기존 장르와 기록은 유지한다. for, if, SELECT, INSERT와 콜백을 응용했다.
// 모든 INSERT가 끝난 뒤 서버를 열기 위해 완료 개수를 센다.
function startServer() {
    app.listen(port, () => {
        console.log(`server running on PORT ${port}`);
    });
}

db.connect(function(err) {
    if (err) throw err;
    const names = ['과학', '소설', '역사', '에세이', '인문', '사회', '철학', '경제·경영', '자기계발', 'IT·컴퓨터', '예술', '시·희곡', '여행'];
    db.query('SELECT * FROM genre', function(err, genres) {
        if (err) throw err;
        let completed = 0;
        for (let i=0; i<names.length; i++) {
            let exists = false;
            for (let j=0; j<genres.length; j++) {
                if (genres[j].name === names[i]) exists = true;
            }
            if (exists) {
                completed++;
                if (completed === names.length) startServer();
            } else {
                db.query('INSERT INTO genre (name) VALUES (?)', [names[i]], function(err, results) {
                    if (err) throw err;
                    completed++;
                    if (completed === names.length) startServer();
                });
            }
        }
    });
});

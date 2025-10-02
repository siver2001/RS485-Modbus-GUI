const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
// Chỉ sử dụng SerialPort
const { SerialPort } = require('serialport'); 
// Cần thêm Parser để xử lý dữ liệu đến theo thời gian ngắt giữa các byte (Inter-byte timeout)
const { InterByteTimeoutParser } = require('@serialport/parser-inter-byte-timeout');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let mainWindow;
// THAY THẾ: Biến toàn cục để quản lý cổng Serial và trạng thái
let serialPort = null;
let modbusParser = null; // <--- THÊM BIẾN TOÀN CỤC MỚI CHO PARSER
let isPortOpen = false;
let currentSlaveId = 1;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        icon: path.join(__dirname, 'assets/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); 
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (serialPort && serialPort.isOpen) {
             serialPort.close(); // Đóng cổng nếu đang mở
        }
        app.quit();
    }
});

// Hàm tính CRC16-Modbus (Tự triển khai)
function calculateCRC16(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer.readUInt8(i);
        for (let j = 0; j < 8; j++) {
            if (crc & 0x0001) {
                crc >>= 1;
                crc ^= 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    // Trả về Buffer 2 byte (Low Byte, High Byte)
    const crcBuffer = Buffer.alloc(2);
    crcBuffer.writeUInt16LE(crc, 0); 
    return crcBuffer;
}

// Hàm tạo gói tin Modbus RTU (Đọc Holding Register - FC 0x03)
function createReadRequest(slaveId, address, count) {
    const pdu = Buffer.alloc(6);
    pdu.writeUInt8(slaveId, 0); // Slave ID
    pdu.writeUInt8(0x03, 1);    // Function Code: Read Holding Registers
    pdu.writeUInt16BE(address, 2); // Start Address (Big Endian)
    pdu.writeUInt16BE(count, 4);   // Quantity of Registers (Big Endian)
    
    const crc = calculateCRC16(pdu.slice(0, 6)); 
    return Buffer.concat([pdu, crc]);
}

// Hàm tạo gói tin Modbus RTU (Ghi Single Register - FC 0x06)
function createWriteRequest(slaveId, address, value) {
    const pdu = Buffer.alloc(6);
    pdu.writeUInt8(slaveId, 0); // Slave ID
    pdu.writeUInt8(0x06, 1);    // Function Code: Write Single Register
    pdu.writeUInt16BE(address, 2); // Register Address (Big Endian)
    pdu.writeUInt16BE(value, 4);   // Data Value (Big Endian)
    
    const crc = calculateCRC16(pdu.slice(0, 6)); 
    return Buffer.concat([pdu, crc]);
}

// Hàm gửi yêu cầu và chờ phản hồi với timeout
async function sendRequestAndAwaitResponse(requestBuffer, timeout = 2000) {
    return new Promise((resolve, reject) => {
        // Cần kiểm tra modbusParser
        if (!serialPort || !serialPort.isOpen || !modbusParser) {
            return reject(new Error('Cổng Serial chưa mở hoặc parser chưa khởi tạo.'));
        }

        // Đặt timeout cho cả giao dịch
        const timeoutId = setTimeout(() => {
            // QUAN TRỌNG: Ngừng lắng nghe dữ liệu từ PARSER
            modbusParser.off('data', onData);
            reject(new Error('Timed out: Thiết bị Modbus không phản hồi.'));
        }, timeout);

        // Lắng nghe dữ liệu
        const onData = (data) => {
            clearTimeout(timeoutId); // Xóa timeout nếu có phản hồi
            // QUAN TRỌNG: Ngừng lắng nghe từ PARSER
            modbusParser.off('data', onData); 
            resolve(data);
        };
        
        // QUAN TRỌNG: Lắng nghe từ modbusParser để nhận gói tin đã được phân khung (framed)
        modbusParser.on('data', onData);

        // Gửi yêu cầu
        serialPort.write(requestBuffer, (err) => {
            if (err) {
                clearTimeout(timeoutId);
                // QUAN TRỌNG: Ngừng lắng nghe từ PARSER
                modbusParser.off('data', onData);
                reject(new Error(`Lỗi gửi dữ liệu: ${err.message}`));
            }
        });
    });
}

// Hàm kiểm tra CRC của gói phản hồi
function isResponseValid(responseBuffer) {
    if (responseBuffer.length < 5) return false;
    const receivedCrc = responseBuffer.slice(responseBuffer.length - 2);
    const calculatedCrc = calculateCRC16(responseBuffer.slice(0, responseBuffer.length - 2));
    
    // So sánh 2 byte CRC
    return receivedCrc[0] === calculatedCrc[0] && receivedCrc[1] === calculatedCrc[1];
}

// Hàm phân tích gói tin Modbus RTU Phản hồi
function parseResponse(responseBuffer, expectedSlaveId, expectedFunctionCode, expectedDataRegisters) {
    if (responseBuffer.length < 5) {
        throw new Error("Phản hồi Modbus quá ngắn, không hợp lệ.");
    }

    const slaveId = responseBuffer.readUInt8(0);
    const functionCode = responseBuffer.readUInt8(1);
    
    // 1. Kiểm tra Slave ID
    if (slaveId !== expectedSlaveId) {
        throw new Error(`Slave ID không khớp (nhận: ${slaveId}, chờ: ${expectedSlaveId}).`);
    }

    // 2. Kiểm tra CRC
    if (!isResponseValid(responseBuffer)) {
        throw new Error('Lỗi CRC: Gói tin bị hỏng (CRC không hợp lệ).');
    }

    // 3. Xử lý Exception (Mã Lỗi: Function Code có bit 7 = 1)
    if (functionCode > 0x80) {
        const exceptionCode = responseBuffer.readUInt8(2);
        throw new Error(`Modbus Exception ${exceptionCode}: ${translateModbusException(exceptionCode)}.`);
    }

    // 4. Kiểm tra Function Code
    if (functionCode !== expectedFunctionCode) {
        throw new Error(`Function Code không khớp (nhận: ${functionCode}, chờ: ${expectedFunctionCode}).`);
    }
    
    // 5. Trích xuất Dữ liệu (chỉ hỗ trợ FC 0x03 và FC 0x06)
    const result = { functionCode, data: [] };

    if (functionCode === 0x03) {
        // Phản hồi FC 0x03: SlaveID (1) + FC (1) + Byte Count (1) + Data (N*2) + CRC (2)
        const byteCount = responseBuffer.readUInt8(2);
        if (byteCount !== expectedDataRegisters * 2) {
             throw new Error(`Dữ liệu không khớp: Chờ ${expectedDataRegisters * 2} byte, nhận ${byteCount} byte.`);
        }
        for (let i = 0; i < expectedDataRegisters; i++) {
            // Dữ liệu thanh ghi (2 byte) là Big Endian
            result.data.push(responseBuffer.readUInt16BE(3 + i * 2)); 
        }
    } else if (functionCode === 0x06) {
        // Phản hồi FC 0x06: SlaveID (1) + FC (1) + Address (2) + Value (2) + CRC (2)
        // Gói tin này chỉ dùng để xác nhận lệnh ghi thành công.
        result.data.push(responseBuffer.readUInt16BE(4)); // Giá trị thanh ghi được echo lại
    }

    return result;
}

// Hàm dịch mã lỗi Modbus Exception Code
function translateModbusException(code) {
    switch(code) {
        case 1: return 'ILLEGAL FUNCTION (Lệnh không hỗ trợ)';
        case 2: return 'ILLEGAL DATA ADDRESS (Địa chỉ thanh ghi không tồn tại)';
        case 3: return 'ILLEGAL DATA VALUE (Giá trị dữ liệu không hợp lệ)';
        case 4: return 'SLAVE DEVICE FAILURE (Lỗi nội bộ thiết bị Slave)';
        default: return 'Lỗi Modbus không xác định';
    }
}


// ===========================================
// IPC Handlers
// ===========================================

// Lấy danh sách cổng COM (KHÔNG ĐỔI - Vẫn hoạt động bình thường)
ipcMain.handle('get-com-ports', async () => {
    try {
        const ports = await SerialPort.list(); 
        return ports.map(port => ({ path: port.path, manufacturer: port.manufacturer }));
    } catch (error) {
        console.error("Error listing COM ports:", error);
        return [];
    }
});

// Kết nối SerialPort (ĐÃ THÊM PARSER VÀ FLUSH)
ipcMain.handle('connect-modbus', async (event, options) => {
    if (serialPort && serialPort.isOpen) {
        return { success: false, message: 'Đã có kết nối SerialPort đang mở. Vui lòng ngắt kết nối trước.' };
    }
    
    try {
        currentSlaveId = parseInt(options.slaveId || '1', 10);
        
        serialPort = new SerialPort({
            path: options.comPath,
            baudRate: parseInt(options.baudRate, 10),
            dataBits: parseInt(options.dataBits, 10),
            parity: options.parity,
            stopBits: parseInt(options.stopBits, 10)
        });

        // Sử dụng parser inter-byte timeout để tự động cắt gói tin Modbus
        const parser = serialPort.pipe(new InterByteTimeoutParser({ interval: 50 })); 
        modbusParser = parser; // <--- GÁN OBJECT PARSER VÀO BIẾN TOÀN CỤC

        // Đặt timeout chờ mở cổng
        await new Promise((resolve, reject) => {
            const openTimeout = setTimeout(() => {
                serialPort.close(() => {}); 
                reject(new Error("Timeout khi mở cổng Serial."));
            }, 3000); // 3 giây
            
            serialPort.once('open', () => {
                clearTimeout(openTimeout);
                isPortOpen = true;
                
                // *** Xóa bộ đệm (Flush) và thêm delay nhỏ ***
                serialPort.flush((flushErr) => {
                    if (flushErr) {
                         console.error("Lỗi khi xóa bộ đệm (flush):", flushErr);
                    }
                    
                    // Thêm một độ trễ ngắn sau khi flush để đảm bảo hệ thống stable
                    delay(50).then(resolve); 
                });
            });
            
            serialPort.once('error', (err) => {
                clearTimeout(openTimeout);
                reject(new Error(`Serial Port Error: ${err.message}`));
            });
        });

        return { success: true, message: `Kết nối SerialPort thành công tới ${options.comPath}` };
    } catch (error) {
        isPortOpen = false;
        console.error("Serial connection error:", error);
        return { success: false, message: error.message };
    }
});

// Ngắt kết nối SerialPort (Cập nhật để reset parser)
ipcMain.handle('disconnect-modbus', async () => {
    if (!isPortOpen) {
        return { success: false, message: 'Không có kết nối SerialPort nào để ngắt.' };
    }
    try {
        await new Promise((resolve, reject) => {
            serialPort.close((err) => {
                if (err) return reject(err);
                isPortOpen = false;
                serialPort = null;
                modbusParser = null; // <--- RESET PARSER
                resolve();
            });
        });
        return { success: true, message: 'Đã ngắt kết nối SerialPort.' };
    } catch (error) {
        console.error("Serial disconnection error:", error);
        return { success: false, message: `Lỗi khi ngắt kết nối: ${error.message}` };
    }
});

// Kiểm tra kết nối (Sử dụng hàm gửi/nhận đã sửa)
ipcMain.handle('test-connection', async (event, { slaveId }) => {
    // ĐIỀU KIỆN NÀY ĐANG CHẶN VÀ TRẢ VỀ LỖI NẾU CỔNG CHƯA MỞ
    if (!isPortOpen) {
        return { success: false, message: 'Vui lòng kết nối cổng COM trước khi kiểm tra kết nối thiết bị.' };
    }

    const testSlaveId = parseInt(slaveId || '1', 10);

    try {
        const testAddress = 0;
        const count = 1;
        
        const requestBuffer = createReadRequest(testSlaveId, testAddress, count);
        // Sử dụng timeout 2000ms
        const responseBuffer = await sendRequestAndAwaitResponse(requestBuffer, 2000); 

        // Kiểm tra phản hồi (Nếu thành công sẽ không ném lỗi)
        parseResponse(responseBuffer, testSlaveId, 0x03, count); 
        
        return { success: true, message: 'Kiểm tra kết nối thành công: Thiết bị Modbus phản hồi.' };

    } catch (error) {
        console.error("Test connection error:", error);
        return { success: false, message: `Kiểm tra kết nối thất bại: ${error.message}` };
    }
});


// Đọc thanh ghi (Sử dụng hàm gửi/nhận đã sửa)
ipcMain.handle('read-register', async (event, { address, count, slaveId }) => {
    if (!isPortOpen) {
        return { success: false, message: 'Không có kết nối SerialPort. Vui lòng kết nối trước.' };
    }
    const currentID = parseInt(slaveId || '1', 10);

    try {
        const requestBuffer = createReadRequest(currentID, address, count);
        // Sử dụng timeout 1000ms
        const responseBuffer = await sendRequestAndAwaitResponse(requestBuffer, 1000);
        
        // Phân tích phản hồi
        const parsed = parseResponse(responseBuffer, currentID, 0x03, count);

        return { success: true, data: parsed.data };
    } catch (error) {
        console.error("Modbus read error:", error);
        return { success: false, message: error.message };
    }
});

// Ghi thanh ghi (Sử dụng hàm gửi/nhận đã sửa)
ipcMain.handle('write-register', async (event, { address, value, slaveId }) => {
    if (!isPortOpen) {
        return { success: false, message: 'Không có kết nối SerialPort. Vui lòng kết nối trước.' };
    }
    const currentID = parseInt(slaveId || '1', 10);
    
    try {
        // Modbus Function Code 0x06: Write Single Holding Register
        const requestBuffer = createWriteRequest(currentID, address, value);
        // Sử dụng timeout 1000ms
        const responseBuffer = await sendRequestAndAwaitResponse(requestBuffer, 1000);
        
        // Phân tích phản hồi (chờ FC 0x06)
        parseResponse(responseBuffer, currentID, 0x06, 1); // 1 là số thanh ghi đã ghi (dummy)

        return { success: true, message: `Ghi thành công giá trị ${value} vào địa chỉ ${address}.` };
    } catch (error) {
        console.error("Modbus write error:", error);
        return { success: false, message: error.message };
    }
});
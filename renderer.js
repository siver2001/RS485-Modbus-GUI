document.addEventListener('DOMContentLoaded', () => {
    // --- Lấy các phần tử DOM ---
    const comPortsSelect = document.getElementById('com-ports');
    const statusDiv = document.getElementById('status');
    const logDiv = document.getElementById('log');

    // Nút điều khiển kết nối
    const btnConnect = document.getElementById('btn-connect');
    const btnDisconnect = document.getElementById('btn-disconnect');
    const btnTestConnection = document.getElementById('btn-test-connection');
    const btnRefreshCom = document.getElementById('btn-refresh-com');

    // Nút thao tác
    const btnRead = document.getElementById('btn-read');
    const btnWrite = document.getElementById('btn-write');

    // Các phần tử cho giao diện động
    const btnConfirmRead = document.getElementById('btn-confirm-read-quantity');
    const btnConfirmWrite = document.getElementById('btn-confirm-write-quantity');
    const readFieldsContainer = document.getElementById('read-fields-container');
    const writeFieldsContainer = document.getElementById('write-fields-container');
    
    const tabs = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    // --- Biến trạng thái cho việc đọc liên tục ---
    let isReading = false;
    let animationFrameId = null; // Thay thế cho intervalId

    // --- Các hàm hỗ trợ ---
    function log(message, type = 'info') {
        const p = document.createElement('p');
        const timestamp = new Date().toLocaleTimeString();
        p.textContent = `[${timestamp}] ${message}`;
        if (type === 'error') p.style.color = '#ff4d4d';
        if (type === 'success') p.style.color = '#73e68c';
        logDiv.appendChild(p);
        logDiv.scrollTop = logDiv.scrollHeight;
    }
    
    function updateConnectionStatus(isConnected, message) {
        statusDiv.textContent = message;
        btnConnect.disabled = isConnected;
        // Bỏ disabled của Test Connection khi đã kết nối COM thành công
        btnTestConnection.disabled = !isConnected; 
        btnDisconnect.disabled = !isConnected;
        btnRead.disabled = !isConnected;
        btnWrite.disabled = !isConnected;
        if (isConnected) {
            statusDiv.className = 'status-connected';
        } else {
            statusDiv.className = 'status-disconnected';
            if (isReading) {
                stopContinuousRead();
            }
        }
    }

    function getInputFormat(tabName) {
        return document.querySelector(`input[name="${tabName}-format"]:checked`).value;
    }

    function parseInput(value, format) {
        if (format === 'hex') return parseInt(value, 16);
        return parseInt(value, 10);
    }
    
    // --- Logic cho Giao diện Động ---
    function generateReadFields() {
        if (isReading) {
            stopContinuousRead();
        }
        const quantity = parseInt(document.getElementById('read-quantity').value, 10);
        const startAddressStr = document.getElementById('read-start-address').value; // Lấy địa chỉ bắt đầu
        const format = getInputFormat('read'); 
        const startAddress = parseInput(startAddressStr, format); // Chuyển đổi sang số

        readFieldsContainer.innerHTML = '';
        
        if (isNaN(quantity) || quantity < 1 || quantity > 50) {
            log('Số lượng thanh ghi không hợp lệ. Vui lòng nhập một số từ 1 đến 50.', 'error');
            return;
        }
        if (isNaN(startAddress)) {
             log('Địa chỉ bắt đầu không hợp lệ.', 'error');
             return;
        }
        
        for (let i = 0; i < quantity; i++) {
            const currentAddress = startAddress + i; // Địa chỉ tăng dần
            // Định dạng lại cho hiển thị (Decimal hoặc Hex)
            const currentAddressStr = format === 'hex' ? currentAddress.toString(16).toUpperCase() : currentAddress.toString(10); 

            const pairDiv = document.createElement('div');
            pairDiv.className = 'dynamic-pair';
            
            const addressInput = document.createElement('input');
            addressInput.type = 'text';
            addressInput.placeholder = `Địa chỉ #${i + 1}`;
            addressInput.className = 'dynamic-read-address';
            addressInput.value = currentAddressStr; // TỰ ĐỘNG ĐIỀN ĐỊA CHỈ
            
            const valueDisplay = document.createElement('input');
            valueDisplay.type = 'text';
            valueDisplay.placeholder = `Giá trị đọc về`;
            valueDisplay.className = 'dynamic-read-value';
            valueDisplay.disabled = true;
            
            pairDiv.appendChild(addressInput);
            pairDiv.appendChild(valueDisplay);
            readFieldsContainer.appendChild(pairDiv);
        }
        log(`Đã tạo ${quantity} cặp ô để đọc địa chỉ, bắt đầu từ ${startAddressStr} (${format.toUpperCase()}).`);
    }

    function generateWriteFields() {
        const quantity = parseInt(document.getElementById('write-quantity').value, 10);
        const startAddressStr = document.getElementById('write-start-address').value; // Lấy địa chỉ bắt đầu
        const format = getInputFormat('write'); 
        const startAddress = parseInput(startAddressStr, format); // Chuyển đổi sang số

        writeFieldsContainer.innerHTML = '';

        if (isNaN(quantity) || quantity < 1 || quantity > 50) {
            log('Số lượng thanh ghi không hợp lệ. Vui lòng nhập một số từ 1 đến 50.', 'error');
            return;
        }
        if (isNaN(startAddress)) {
             log('Địa chỉ bắt đầu không hợp lệ.', 'error');
             return;
        }
        
        for (let i = 0; i < quantity; i++) {
            const currentAddress = startAddress + i; // Địa chỉ tăng dần
            // Định dạng lại cho hiển thị (Decimal hoặc Hex)
            const currentAddressStr = format === 'hex' ? currentAddress.toString(16).toUpperCase() : currentAddress.toString(10); 

            const pairDiv = document.createElement('div');
            pairDiv.className = 'dynamic-pair';
            
            const addressInput = document.createElement('input');
            addressInput.type = 'text';
            addressInput.placeholder = `Địa chỉ #${i + 1}`;
            addressInput.className = 'dynamic-write-address';
            addressInput.value = currentAddressStr; // TỰ ĐỘNG ĐIỀN ĐỊA CHỈ
            
            const valueInput = document.createElement('input');
            valueInput.type = 'text';
            valueInput.placeholder = `Giá trị (Dec) #${i + 1}`;
            valueInput.className = 'dynamic-write-value';
            
            pairDiv.appendChild(addressInput);
            pairDiv.appendChild(valueInput);
            writeFieldsContainer.appendChild(pairDiv);
        }
        log(`Đã tạo ${quantity} cặp ô để ghi địa chỉ/giá trị, bắt đầu từ ${startAddressStr} (${format.toUpperCase()}).`);
    }

    // --- Logic Đọc Real-time ---

    // Vòng lặp đọc chính
    async function readLoop() {
    if (!isReading) return; // Dừng lại nếu isReading là false

    const format = getInputFormat('read');
    const addressInputs = document.querySelectorAll('.dynamic-read-address');
    const valueDisplays = document.querySelectorAll('.dynamic-read-value');

    const slaveId = document.getElementById('slave-id').value; 

    // CHÚ Ý: Thay vì dùng Promise.all (song song), ta dùng vòng lặp for...of để gửi TỪNG lệnh
    const delayBetweenReads = 100; // Thử nghiệm với độ trễ 100ms giữa các lệnh
    
    for (let i = 0; i < addressInputs.length; i++) {
        if (!isReading) return; // Kiểm tra lại nếu người dùng đã nhấn Huỷ đọc
        
        const addressStr = addressInputs[i].value;
        if (!addressStr.trim()) {
            valueDisplays[i].value = "";
            continue;
        }

        const address = parseInput(addressStr, format);
        if (isNaN(address)) {
            valueDisplays[i].value = "Lỗi địa chỉ";
            continue;
        }

        // Thực hiện lệnh đọc cho từng địa chỉ
        try {
            // Gửi lệnh đọc và chờ phản hồi
            const result = await window.api.readRegister({ address, count: 1, slaveId });
            
            if (result.success) {
                valueDisplays[i].value = result.data && result.data.length > 0 ? result.data[0].toString(10) : "N/A";
            } else {
                valueDisplays[i].value = "Lỗi";
                log(`Lỗi đọc địa chỉ ${address}: ${result.message}`, 'error');
                // Tùy chọn: Dừng vòng lặp nếu gặp lỗi nghiêm trọng
                // stopContinuousRead(); 
                // return; 
            }
        } catch (error) {
            log(`Lỗi nghiêm trọng khi đọc: ${error.message}`, 'error');
            stopContinuousRead();
            return;
        }

        // THÊM ĐỘ TRỄ để thiết bị Slave có thời gian xử lý và chuẩn bị cho lệnh tiếp theo
        await new Promise(resolve => setTimeout(resolve, delayBetweenReads));
    }
    
    // Gọi lại chính nó để tạo vòng lặp tiếp theo
    animationFrameId = requestAnimationFrame(readLoop);
}

    function startContinuousRead() {
        isReading = true;
        btnRead.textContent = 'Huỷ Đọc';
        btnRead.classList.add('reading');
        log('Bắt đầu đọc real-time...');
        
        // Bắt đầu vòng lặp
        readLoop();
    }

    function stopContinuousRead() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        animationFrameId = null;
        isReading = false;
        btnRead.textContent = 'Thực hiện Đọc';
        btnRead.classList.remove('reading');
        log('Đã dừng đọc.');
    }
    
    // --- Khởi tạo và Sự kiện ---
    async function loadComPorts() {
        log('Đang tìm kiếm cổng COM...');
        const ports = await window.api.getComPorts();
        comPortsSelect.innerHTML = '';
        if (ports.length === 0) {
            log('Không tìm thấy cổng COM nào.', 'error');
        } else {
            ports.forEach(port => {
                const option = document.createElement('option');
                option.value = port.path;
                option.textContent = port.path;
                comPortsSelect.appendChild(option);
            });
            log(`Đã tìm thấy ${ports.length} cổng COM.`);
        }
    }
    loadComPorts();
    generateReadFields();
    generateWriteFields();

    btnRefreshCom.addEventListener('click', loadComPorts);
    btnConfirmRead.addEventListener('click', generateReadFields);
    btnConfirmWrite.addEventListener('click', generateWriteFields);

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(item => item.classList.remove('active'));
            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.tab);
            tabContents.forEach(content => content.classList.remove('active'));
            target.classList.add('active');
        });
    });

    // SỬA LẠI: Chỉ kết nối COM. Nút Test Connection sẽ kiểm tra Slave ID.
    btnConnect.addEventListener('click', async () => {
        const options = {
            comPath: comPortsSelect.value,
            baudRate: document.getElementById('baud-rate').value,
            parity: document.getElementById('parity').value,
            dataBits: document.getElementById('data-bits').value,
            stopBits: document.getElementById('stop-bits').value
        };
        if (!options.comPath) {
            log('Vui lòng chọn một cổng COM.', 'error'); return;
        }
        log(`Đang kết nối cổng COM: ${options.comPath}...`);
        const result = await window.api.connectModbus(options);
        
        if (result.success) {
            updateConnectionStatus(true, `ĐÃ KẾT NỐI: ${options.comPath}`);
            log(result.message, 'success');
        } else {
            updateConnectionStatus(false, 'NGẮT KẾT NỐI');
            log(result.message, 'error');
        }
    });

    btnDisconnect.addEventListener('click', async () => {
        log('Đang ngắt kết nối...');
        if (isReading) {
            stopContinuousRead();
        }
        const result = await window.api.disconnectModbus();
        updateConnectionStatus(false, 'NGẮT KẾT NỐI');
        log(result.message, result.success ? 'info' : 'error');
    });

    // SỬA LẠI: Thực hiện kiểm tra kết nối Slave ID sau khi cổng COM đã mở
    btnTestConnection.addEventListener('click', async () => {
        const connectionOptions = { comPath: comPortsSelect.value, baudRate: document.getElementById('baud-rate').value, parity: document.getElementById('parity').value, dataBits: document.getElementById('data-bits').value, stopBits: document.getElementById('stop-bits').value };
        const slaveId = document.getElementById('slave-id').value;
        
        // Kiểm tra xem cổng COM đã được chọn chưa (trước khi gọi API)
        if (!connectionOptions.comPath) { 
            log('Lỗi: Vui lòng chọn một cổng COM.', 'error'); 
            return; 
        }

        log(`Đang kiểm tra kết nối với Slave ID: ${slaveId}...`);
        
        // Gọi API testConnection, API này sẽ kiểm tra isPortOpen trước khi gửi lệnh
        const result = await window.api.testConnection({ connectionOptions, slaveId });
        
        if (result.success) { 
            log(result.message, 'success'); 
        } else { 
            log(result.message, 'error'); 
        }
    });

    // --- Sự kiện ĐỌC ---
    btnRead.addEventListener('click', () => {
        if (isReading) {
            stopContinuousRead();
        } else {
            startContinuousRead();
        }
    });
    
    // --- Sự kiện GHI ---
    btnWrite.addEventListener('click', async () => {
        if (isReading) {
            log('Vui lòng dừng đọc trước khi thực hiện ghi.', 'error');
            return;
        }

        const format = getInputFormat('write');
        const addressInputs = document.querySelectorAll('.dynamic-write-address');
        const valueInputs = document.querySelectorAll('.dynamic-write-value');

        const slaveId = document.getElementById('slave-id').value;

        log(`Bắt đầu ghi vào ${addressInputs.length} địa chỉ...`);

        for (let i = 0; i < addressInputs.length; i++) {
            const addressStr = addressInputs[i].value;
            const valueStr = valueInputs[i].value;

            if (!addressStr.trim() && !valueStr.trim()) continue;

            const address = parseInput(addressStr, format);
            const value = parseInt(valueStr, 10);

            if (isNaN(address) || isNaN(value)) {
                log(`Lỗi: Dữ liệu không hợp lệ ở cặp #${i + 1} (Địa chỉ: "${addressStr}", Giá trị: "${valueStr}"). Bỏ qua.`, 'error');
                continue;
            }

            log(`--> Đang ghi: Địa chỉ ${address} (Dec), Giá trị ${value} (Dec)`);
            
            const result = await window.api.writeRegister({ address, value, slaveId });

            if (result.success) {
                log(`<-- ${result.message}`, 'success');
            } else {
                log(`<-- Lỗi khi ghi vào địa chỉ ${address}: ${result.message}`, 'error');
            }
        }
        log('Hoàn tất quá trình ghi.');
    });
});
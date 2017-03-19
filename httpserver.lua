-- Small HTTP server for NodeMCU
--
-- PUT creates a new file in flash
-- GET returns the contents of a file in flash
-- DELETE remove the file from flash
-- POST executes the given lua script (may return a function that receives the payload)
-- OPTIONS returns minimal CORS headers allowing POST from any origin
--
-- TODO: need a way to return flash contents vs. index.html

local requests = {}

local function onConnect(connection)

  local function close()
    connection:close()
  end

  local function onReceive(connection, request)
    collectgarbage()
    local method, uri = request:match("^([A-Z]+) /([^?]*).- HTTP/[1-9]+.[0-9]+\r\n")

    if method == "PUT" and uri ~= "" then
      file.close()
      if not file.open("temp/put", "w") then
        connection:send("HTTP/1.1 500 Error\r\nConnection: close\r\n\r\nCreate error\n", close)
      else
        -- Track Content-Length so we know when we're done
        local contentLength = tonumber(request:match("\r\nContent%-Length: (%S+)\r\n"))

        local function done(connection)
          collectgarbage()
          file.close()
          if contentLength <= 0 then
            file.remove(uri)
            file.rename("temp/put", uri)
          else
            file.remove("temp/put")
          end
        end
        connection:on("disconnection", done)

        -- From now on, send everything to the file
        local function writeFile(connection, payload)
          collectgarbage()
          if file.write(payload) then
            contentLength = contentLength - #payload
            if contentLength <= 0 then
              connection:send("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nSaved\n", close)
              done()
            end
          else
            connection:send("HTTP/1.1 500 Error\r\nConnection: close\r\n\r\nWrite error\n", close)
            done()
          end
        end
        connection:on("receive", writeFile)

        if request:find("\r\nExpect: 100-continue\r\n", 1, true) then
          -- Send 100 Continue if the client expects it
          connection:send("HTTP/1.1 100 Continue\r\nConnection: close\r\n\r\n")
        else
          -- Find the start of the body (if any)
          local body_start = request:find("\r\n\r\n", 1, true) + 4
          writeFile(connection, request:sub(body_start))
        end
      end
    elseif method == "DELETE" then
      -- Delete the file from flash
      file.remove(uri)
      connection:send("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nDeleted\n", close)
    elseif method == "POST" then
      if uri == "" then
        -- Reboot the device
        connection:send("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nRebooting\n", node.restart)
      else
        -- Poor man's CGI
        local func = dofile(uri)
        if func then
          func(connection, request)
          -- If you want your function to receive any other packets as well, do this:
          --connection:on("receive", func)
        else
          connection:send("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n", close)
        end
      end
    elseif method == "GET" then
      -- Check for websocket header
      local secwebsocketkey = request:find("\r\nSec-WebSocket-Key:", 1, true)
      if secwebsocketkey then
        local func = dofile(uri)
        if func then
          func(connection, request)
          return
        end
      end

      local function nextFile()
        collectgarbage()
        if #requests == 0 then return end
        local connection, uri = unpack(requests[1])

        -- Send the file contents to the client
        local headers = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n"
        --local encoding = request:find("\r\nAccept%-Encoding: gzip")
        if #uri < 30 and file.open(uri .. ".gz", "r") then
          headers = "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nConnection: close\r\n\r\n"
        elseif not file.open(uri, "r") then
          connection:send("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\nFile not found\n", close)
          table.remove(requests, 1)
          nextFile()
          return
        end

        local function onSent(connection)
          collectgarbage()
          local c = file.read(500)
          if c then
            connection:send(c)
          else
            file.close()
            connection:close()
            table.remove(requests, 1)
            nextFile()
          end
        end

        connection:on("sent", onSent)
        connection:send(headers)
      end

      -- Default document handler
      if uri == "" then
        uri = "index.html"
      end

      table.insert(requests, { connection, uri })
      if #requests == 1 then
        nextFile()
      end
    elseif method == "OPTIONS" then
      connection:send("HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST,OPTIONS\r\nConnection: close\r\n\r\n", close)
    else
      connection:send("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n", close)
    end
  end

  connection:on("receive", onReceive)
end

return function (port)
  local s = net.createServer(net.TCP, 28800) -- 10 seconds client timeout
  s:listen(port, onConnect)

  -- false and nil evaluate as false
  local ip = wifi.sta.getip()
  if not ip then ip = wifi.ap.getip() end
  print("nodemcu-httpserver running at http://" .. ip .. ":" ..  port)
  return s
end


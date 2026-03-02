up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

restart:
	docker compose down && docker compose up --build

reset: restart

clean:
	docker compose down -v --rmi all
